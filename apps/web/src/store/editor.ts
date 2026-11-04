import { create } from 'zustand';
import { AudioOutput } from '../audio/client';
import { TimelineEngine } from '../engine/engine';
import {
  clipEnd,
  type Clip,
  type TextContent,
  type TimelineSnapshot,
  type TrackKind,
} from '../engine/types';
import { framesToMicros, microsToFrames } from '../lib/time';
import { RenderClient } from '../render/client';
import { ThumbnailClient } from '../thumbnails/client';
import type { ProjectAsset } from '../project/document';
import type { RendererBackend } from '../render/protocol';
import { trackRows, type View } from '../timeline/geometry';

const MAX_HISTORY = 100;

/** An imported media file. `missing` means its data isn't available (needs relinking). */
export type EditorAsset = ProjectAsset & { missing: boolean };

/** Notifications for the project layer (autosave, media storage). */
export type EditorEvent = { type: 'changed' } | { type: 'assetAdded'; id: string; file: File };

export interface EditorState {
  ready: boolean;
  timeline: TimelineSnapshot;
  duration: number;
  assets: Record<string, EditorAsset>;
  /** Waveform peaks per asset (see audio/protocol.ts PEAKS_PER_SECOND). */
  peaks: Record<string, Float32Array>;
  /** Bumped when thumbnails arrive; the bitmaps themselves live in `thumbnails`. */
  thumbsVersion: number;
  playhead: number;
  playing: boolean;
  selectedClipId: number | null;
  view: View;
  importing: number;
  message: { kind: 'error' | 'info'; text: string } | null;
  backend: RendererBackend | null;
  lastFrameMs: number;
  /** Whether playback is driven by the audio clock (false: wall clock, no sound). */
  audioClock: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const useEditor = create<EditorState>(() => ({
  ready: false,
  timeline: { tracks: [] },
  duration: 0,
  assets: {},
  peaks: {},
  thumbsVersion: 0,
  playhead: 0,
  playing: false,
  selectedClipId: null,
  view: { pxPerSecond: 60, scrollUs: 0, scrollY: 0 },
  importing: 0,
  message: null,
  backend: null,
  lastFrameMs: 0,
  audioClock: true,
  canUndo: false,
  canRedo: false,
}));

const set = useEditor.setState;
const get = useEditor.getState;

// Services live outside React: they are long-lived and not serialisable state.
let engine: TimelineEngine | null = null;
export const renderer = new RenderClient();
renderer.onStats((stats) => set({ backend: stats.backend, lastFrameMs: stats.lastFrameMs }));
export const audio = new AudioOutput();
audio.onPeaks((id, data) => set((s) => ({ peaks: { ...s.peaks, [id]: data } })));
export const thumbnails = new ThumbnailClient();
thumbnails.onUpdate(() => set((s) => ({ thumbsVersion: s.thumbsVersion + 1 })));

/** Source files by asset id, kept so exports can re-read the media. */
const assetFiles = new Map<string, File>();

const undoStack: string[] = [];
const redoStack: string[] = [];

const listeners = new Set<(event: EditorEvent) => void>();
export function subscribeEditor(listener: (event: EditorEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(event: EditorEvent) {
  for (const listener of listeners) listener(event);
}

export async function initEditor(): Promise<void> {
  if (engine) return;
  engine = await TimelineEngine.create();
  engine.addTrack('video');
  engine.addTrack('audio');
  EMPTY_TIMELINE = engine.save();
  set({ ready: true, audioClock: audio.available });
  refresh();
}

/** A new project's timeline: one video and one audio track. */
let EMPTY_TIMELINE = '';

function requireEngine(): TimelineEngine {
  if (!engine) throw new Error('Engine not initialised');
  return engine;
}

/** Push the engine's state into the store, the preview and the audio mixer. */
function refresh() {
  const e = requireEngine();
  const duration = e.duration();
  set((s) => ({
    timeline: e.snapshot(),
    duration,
    playhead: Math.min(s.playhead, duration),
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }));
  if (get().playing) audio.update(e.audioSegments());
  requestFrame();
}

export function requestFrame() {
  if (!engine) return;
  renderer.render(engine.resolve(get().playhead));
}

/**
 * Run an editing operation with undo support. Edits are atomic: an operation
 * may take several engine steps (e.g. create a track, then move a clip into
 * it), and if any step is rejected, the timeline is restored exactly as it was
 * and the reason is shown.
 */
export function edit(operation: (engine: TimelineEngine) => void): boolean {
  const e = requireEngine();
  const before = e.save();
  try {
    operation(e);
  } catch (error) {
    e.load(before); // roll back any steps that already succeeded
    notify('error', error instanceof Error ? error.message : String(error));
    return false;
  }
  // Nothing actually changed (e.g. text committed unchanged): no undo step, no autosave.
  if (e.save() === before) return true;
  undoStack.push(before);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  refresh();
  emit({ type: 'changed' });
  return true;
}

export function undo() {
  const e = requireEngine();
  const previous = undoStack.pop();
  if (previous === undefined) return;
  redoStack.push(e.save());
  e.load(previous);
  refresh();
  keepSelectionIfPresent();
  emit({ type: 'changed' });
}

export function redo() {
  const e = requireEngine();
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(e.save());
  e.load(next);
  refresh();
  keepSelectionIfPresent();
  emit({ type: 'changed' });
}

/**
 * After undo/redo, keep the selected clip selected if it still exists, so an
 * open inspector stays on the clip being edited; otherwise clear it.
 */
function keepSelectionIfPresent() {
  const { selectedClipId, timeline } = get();
  if (selectedClipId === null) return;
  const exists = timeline.tracks.some((t) => t.clips.some((c) => c.id === selectedClipId));
  if (!exists) set({ selectedClipId: null });
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(kind: 'error' | 'info', text: string) {
  set({ message: { kind, text } });
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => set({ message: null }), 4000);
}

// ---------------------------------------------------------------- media import

const MEDIA_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|mp3|m4a|aac|wav|ogg|opus|flac)$/i;

const isMedia = (f: File) =>
  f.type.startsWith('video/') || f.type.startsWith('audio/') || MEDIA_EXTENSIONS.test(f.name);

/**
 * Probe a file in both workers (in parallel) and describe it. The workers keep
 * their decoders for `id`, so the asset is playable as soon as this resolves.
 */
async function probeAsset(id: string, file: File): Promise<EditorAsset> {
  const [visual, sound] = await Promise.all([
    renderer.addAsset(id, file),
    audio.addAsset(id, file).catch((error: unknown) => {
      notify('error', `${file.name}: audio could not be read (${String(error)})`);
      return { hasAudio: false, durationUs: 0 };
    }),
  ]);
  if (!visual.hasVideo && !sound.hasAudio) throw new Error('no playable video or audio found');
  if (visual.hasVideo) thumbnails.request(id, file);
  return {
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    width: visual.width,
    height: visual.height,
    codec: visual.codec,
    hasVideo: visual.hasVideo,
    hasAudio: sound.hasAudio,
    // Video length decides a video clip; audio-only files use the audio length.
    durationUs: visual.hasVideo ? visual.durationUs : sound.durationUs,
    missing: false,
  };
}

export async function importFiles(files: Iterable<File>) {
  const media = [...files].filter(isMedia);
  if (media.length === 0) {
    notify('error', 'Please choose a video or audio file (MP4, WebM, MOV, MKV, MP3, WAV, …).');
    return;
  }
  for (const file of media) {
    set((s) => ({ importing: s.importing + 1 }));
    try {
      const id = crypto.randomUUID();
      const asset = await probeAsset(id, file);
      assetFiles.set(id, file);
      set((s) => ({ assets: { ...s.assets, [id]: asset } }));
      emit({ type: 'assetAdded', id, file });
      const kind = asset.hasVideo ? 'video' : 'audio';
      const track = get().timeline.tracks.find((t) => t.kind === kind);
      if (track) edit((e) => e.appendClip(track.id, id, asset.durationUs));
    } catch (error) {
      notify('error', `${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      set((s) => ({ importing: s.importing - 1 }));
    }
  }
}

/** Provide the data for a missing asset. Returns false if the file doesn't fit. */
export async function relinkAsset(id: string, file: File): Promise<boolean> {
  const previous = get().assets[id];
  if (!previous) return false;
  try {
    const asset = await probeAsset(id, file);
    if (previous.hasVideo && !asset.hasVideo) {
      throw new Error('it has no video, but the clips using it need video');
    }
    assetFiles.set(id, file);
    set((s) => ({ assets: { ...s.assets, [id]: asset } }));
    emit({ type: 'assetAdded', id, file });
    emit({ type: 'changed' });
    requestFrame();
    return true;
  } catch (error) {
    notify('error', `${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ---------------------------------------------------------------- project state

/** Everything the project file needs from the editor. */
export function snapshotProject() {
  const e = requireEngine();
  const assets = Object.values(get().assets).map(({ missing: _missing, ...asset }) => asset);
  return { timeline: JSON.parse(e.save()) as unknown, durationUs: e.duration(), assets };
}

/**
 * Replace the editor contents with a project. Media with no file is marked
 * missing; its clips stay on the timeline (black and silent) until relinked.
 * Throws if the timeline is invalid, leaving the current project untouched.
 */
export async function loadProject(project: {
  timeline: unknown;
  assets: ProjectAsset[];
  files: ReadonlyMap<string, File>;
}): Promise<void> {
  const e = requireEngine();
  // Validate first so a bad project never replaces a good one.
  const json = project.timeline === null ? null : JSON.stringify(project.timeline);
  const fresh = await TimelineEngine.create();
  try {
    if (json) fresh.load(json);
  } finally {
    fresh.free();
  }

  pause();
  renderer.clearAssets();
  audio.clearAssets();
  thumbnails.clear();
  assetFiles.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  if (json) {
    e.load(json);
  } else {
    e.load(EMPTY_TIMELINE);
  }
  const assets: Record<string, EditorAsset> = {};
  for (const asset of project.assets) assets[asset.id] = { ...asset, missing: true };
  set({
    assets,
    peaks: {},
    playhead: 0,
    selectedClipId: null,
    view: { pxPerSecond: 60, scrollUs: 0, scrollY: 0 },
  });
  refresh();

  // Re-open the media in the workers.
  await Promise.all(
    project.assets.map(async ({ id }) => {
      const file = project.files.get(id);
      if (!file) return;
      try {
        const asset = await probeAsset(id, file);
        assetFiles.set(id, file);
        set((s) => ({ assets: { ...s.assets, [id]: asset } }));
      } catch {
        // Unreadable stored copy: leave it marked missing so the user can relink.
      }
    }),
  );
  requestFrame();
}

/** What an export needs: the saved project and the files its clips use. */
export function projectForExport() {
  const e = requireEngine();
  const used = new Set(get().timeline.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));
  const missing = [...used].filter((id) => get().assets[id]?.missing).length;
  const assets = [...used].flatMap((id) => {
    const file = assetFiles.get(id);
    return file ? [{ id, file }] : [];
  });
  const firstMedia = get()
    .timeline.tracks.flatMap((t) => t.clips)
    .find((c) => get().assets[c.assetId]);
  const baseName = (firstMedia && get().assets[firstMedia.assetId]?.name) ?? 'framewright-export';
  return { projectJson: e.save(), assets, baseName, durationUs: e.duration(), missing };
}

// ---------------------------------------------------------------- playback

/**
 * Picture follows sound: while playing, the playhead is read from the audio
 * output's clock (frames actually played). If audio can't start, a watchdog
 * switches to the wall clock so playback still works, silently.
 */
const AUDIO_WATCHDOG_MS = 1000;

let playbackFrame = 0;
let playFromUs = 0;
let wallStartMs = 0;
let lastClockUs = 0;
let lastClockChangeMs = 0;

function startClock(fromUs: number) {
  playFromUs = fromUs;
  wallStartMs = performance.now();
  lastClockUs = fromUs;
  lastClockChangeMs = wallStartMs;
  if (get().audioClock) void audio.start(fromUs, requireEngine().audioSegments());
}

function currentTimeUs(now: number): number {
  if (!get().audioClock) return playFromUs + (now - wallStartMs) * 1000;
  const clock = audio.clockUs();
  if (clock !== lastClockUs) {
    lastClockUs = clock;
    lastClockChangeMs = now;
  } else if (now - lastClockChangeMs > AUDIO_WATCHDOG_MS) {
    // Audio output never started (blocked autoplay, no device…): fall back.
    audio.stop();
    set({ audioClock: false });
    notify('info', 'Audio output is unavailable, so playback continues without sound.');
    playFromUs = clock;
    wallStartMs = now;
  }
  return clock;
}

export function seek(us: number) {
  const clamped = Math.max(0, Math.min(Math.round(us), get().duration));
  set({ playhead: clamped });
  if (get().playing) startClock(clamped);
  requestFrame();
}

export function stepFrames(frames: number) {
  pause();
  // Step on the frame grid so repeated steps never drift.
  seek(framesToMicros(microsToFrames(get().playhead) + frames));
}

/** Must be called from a user gesture (click or key press) so audio may start. */
export function play() {
  const { duration, playhead, playing } = get();
  if (playing || duration === 0) return;
  const from = playhead >= duration ? 0 : playhead; // restart at the end
  set({ playing: true, playhead: from });
  startClock(from);

  const tick = (now: number) => {
    if (!get().playing) return;
    const position = currentTimeUs(now);
    if (position >= get().duration) {
      pause();
      seek(get().duration);
      return;
    }
    set({ playhead: Math.round(position) });
    requestFrame();
    playbackFrame = requestAnimationFrame(tick);
  };
  playbackFrame = requestAnimationFrame(tick);
}

export function pause() {
  cancelAnimationFrame(playbackFrame);
  if (get().playing) audio.stop();
  set({ playing: false });
}

export const togglePlay = () => (get().playing ? pause() : play());

// ---------------------------------------------------------------- editing commands

export const selectClip = (clipId: number | null) => set({ selectedClipId: clipId });

export function selectedClip(state: EditorState = get()): Clip | null {
  if (state.selectedClipId === null) return null;
  for (const track of state.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === state.selectedClipId);
    if (clip) return clip;
  }
  return null;
}

/** Split the selected clip at the playhead, or the top clip under the playhead. */
export function splitAtPlayhead() {
  const { timeline, playhead, selectedClipId } = get();
  // Display order, so the topmost visible clip wins when tracks overlap.
  const clips = trackRows(timeline).flatMap((t) => t.clips);
  const underPlayhead = (c: Clip) => c.start < playhead && playhead < clipEnd(c);
  const target =
    clips.find((c) => c.id === selectedClipId && underPlayhead(c)) ?? clips.find(underPlayhead);
  if (!target) {
    notify('info', 'Move the playhead over a clip to split it.');
    return;
  }
  edit((e) => e.splitClip(target.id, playhead));
}

export function deleteSelected() {
  const { selectedClipId } = get();
  if (selectedClipId === null) return;
  const removed = edit((e) => {
    e.removeClip(selectedClipId);
    e.pruneEmptyTracks(); // same undo step: undo brings the track back too
  });
  if (removed) set({ selectedClipId: null });
}

/**
 * Move a clip in time and, optionally, to another track of the same kind or a
 * brand-new track. Tracks left empty are removed in the same (undoable) step.
 */
export function moveClip(
  clipId: number,
  start: number,
  target: { trackId: number } | { newTrack: TrackKind } | null = null,
): boolean {
  return edit((e) => {
    const trackId =
      target === null
        ? undefined
        : 'newTrack' in target
          ? e.addTrack(target.newTrack)
          : target.trackId;
    e.moveClip(clipId, start, trackId);
    e.pruneEmptyTracks();
  });
}

/** Default length of a new title. */
const TEXT_DURATION_US = 3_000_000;

/**
 * Add a title at the playhead on a new top video track, so it overlays
 * whatever is underneath, and select it for editing. One undo step.
 */
export function addText(text = 'Your text'): void {
  let created: number | null = null;
  const added = edit((e) => {
    const track = e.addTrack('video');
    created = e.addTextClip(track, get().playhead, TEXT_DURATION_US, {
      text,
      style: e.defaultTextStyle(),
    });
  });
  if (added && created !== null) selectClip(created);
}

/** Replace a text clip's content and style (validated by the engine). */
export function updateText(clipId: number, content: TextContent): boolean {
  return edit((e) => e.setClipText(clipId, content));
}

export function setClipVolume(clipId: number, percent: number) {
  edit((e) => e.setClipVolume(clipId, percent));
}

export function toggleMute(clipId: number) {
  const clip = selectedClip();
  if (clip?.id !== clipId) return;
  edit((e) => e.setClipMuted(clipId, !clip.muted));
}

export function setView(view: Partial<View>) {
  set((s) => ({ view: { ...s.view, ...view } }));
}
