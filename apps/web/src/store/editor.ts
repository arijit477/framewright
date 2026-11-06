import { create } from 'zustand';
import { AudioOutput } from '../audio/client';
import { TimelineEngine } from '../engine/engine';
import {
  clipEnd,
  IDENTITY_TRANSFORM,
  type AspectRatio,
  type Clip,
  type ColorAdjust,
  type CopiedClip,
  type Keyframe,
  type Easing,
  type LutRef,
  type Micros,
  type TextContent,
  type TextStyle,
  type TimelineSnapshot,
  type TrackKind,
  type Transform,
  type Transition,
} from '../engine/types';
import {
  adjacentKeyframe,
  coversTime,
  keyframeAt,
  roundTransform,
  sourceTimeAt,
  timelineTimeOf,
} from '../lib/keyframes';
import { bilingualStyles } from '../captions/bilingual';
import { wrapLines, type Caption } from '../captions/segments';
import { combineCues, type CaptionCue } from '../captions/srt';
import { aspectOf, compositionSize } from '../lib/aspect';
import { isStillFile, STILL_DURATION_US } from '../media/still';
import { cleanLutName, lutUsage } from '../lib/luts';
import { NEUTRAL_COLOR } from '../render/color';
import { formatTimecode, framesToMicros, microsToFrames } from '../lib/time';
import { RenderClient } from '../render/client';
import { ThumbnailClient } from '../thumbnails/client';
import type { ProjectAsset, ProjectLut } from '../project/document';
import { decodeLut, encodeLut, parseCube, type Lut } from '../render/lut';
import type { LutData } from '../render/protocol';
import type { RendererBackend } from '../render/protocol';
import { trackNames, trackRows, type View } from '../timeline/geometry';

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
  /** The clip the panel edits: the last one clicked. Always in `selectedClipIds`. */
  selectedClipId: number | null;
  /** Every selected clip (Ctrl/⌘/Shift-click adds and removes; Ctrl/⌘+A selects all). */
  selectedClipIds: number[];
  /** What screen readers hear after a keyboard action on the timeline (a live region). */
  announcement: string;
  /** LUTs imported into the project, by id (saved with it; clips refer to them). */
  luts: Record<string, ProjectLut>;
  view: View;
  importing: number;
  message: { kind: 'error' | 'info'; text: string } | null;
  backend: RendererBackend | null;
  lastFrameMs: number;
  /** Whether playback is driven by the audio clock (false: wall clock, no sound). */
  audioClock: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Ripple editing: deleting, trimming and speed changes move the later clips
   * on the same track along. A per-browser preference, not part of projects.
   */
  ripple: boolean;
}

const RIPPLE_KEY = 'framewright.ripple';

/** Storage can be unavailable (private mode, blocked site data): fall back to off. */
function loadRipple(): boolean {
  try {
    return globalThis.localStorage?.getItem(RIPPLE_KEY) === 'on';
  } catch {
    return false;
  }
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
  selectedClipIds: [],
  announcement: '',
  luts: {},
  ripple: loadRipple(),
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
renderer.onNotice((message) => notify('error', message));
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
/** The frame size last sent to the renderer. */
let renderedAspect: AspectRatio | null = null;

function refresh() {
  const e = requireEngine();
  const duration = e.duration();
  const timeline = e.snapshot();
  const aspect = aspectOf(timeline);
  if (aspect !== renderedAspect) {
    renderedAspect = aspect;
    renderer.resize(compositionSize(aspect)); // before the frame below is drawn
  }
  set((s) => ({
    timeline,
    duration,
    playhead: Math.min(s.playhead, duration),
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  }));
  if (get().playing) audio.update(e.audioSegments());
  restoreReferencedLuts();
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
  const { selectedClipId, selectedClipIds, timeline } = get();
  if (selectedClipIds.length === 0) return;
  const existing = new Set(timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const ids = selectedClipIds.filter((id) => existing.has(id));
  if (ids.length === selectedClipIds.length) return;
  const primary = selectedClipId !== null && existing.has(selectedClipId) ? selectedClipId : null;
  set({ selectedClipIds: ids, selectedClipId: primary ?? ids.at(-1) ?? null });
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
  f.type.startsWith('video/') ||
  f.type.startsWith('audio/') ||
  MEDIA_EXTENSIONS.test(f.name) ||
  isStillFile(f);

/**
 * Probe a file in both workers (in parallel) and describe it. The workers keep
 * their decoders for `id`, so the asset is playable as soon as this resolves.
 */
async function probeAsset(id: string, file: File): Promise<EditorAsset> {
  const still = isStillFile(file);
  const [visual, sound] = await Promise.all([
    renderer.addAsset(id, file),
    still
      ? { hasAudio: false, durationUs: 0 } // an image has no sound
      : audio.addAsset(id, file).catch((error: unknown) => {
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
    ...(visual.still ? { still: true } : {}),
    missing: false,
  };
}

export async function importFiles(files: Iterable<File>) {
  const media = [...files].filter(isMedia);
  if (media.length === 0) {
    notify(
      'error',
      'Please choose a video, audio or image file (MP4, WebM, MOV, MP3, WAV, PNG, JPEG, …).',
    );
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
      if (track) {
        edit((e) =>
          asset.still
            ? e.appendStillClip(track.id, id, STILL_DURATION_US)
            : e.appendClip(track.id, id, asset.durationUs),
        );
      }
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
    if (Boolean(previous.still) !== Boolean(asset.still)) {
      throw new Error(
        previous.still ? 'the clips using it need an image' : 'it’s an image, not a video',
      );
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
  const luts = Object.values(get().luts);
  return { timeline: JSON.parse(e.save()) as unknown, durationUs: e.duration(), assets, luts };
}

// ---------------------------------------------------------------- LUTs

/** Decoded LUTs (the project keeps them encoded), by id. */
const decodedLuts = new Map<string, Lut>();

/** Decoded LUTs for the given ids (all of them by default), for the workers. */
function lutsFor(ids: Iterable<string> = decodedLuts.keys()): LutData[] {
  return [...new Set(ids)].flatMap((id) => {
    const lut = decodedLuts.get(id);
    return lut ? [{ id, ...lut }] : [];
  });
}

/** Replace the project's LUTs (on load); damaged ones are left out with a notice. */
function setProjectLuts(luts: readonly ProjectLut[]) {
  decodedLuts.clear();
  removedLuts.clear();
  const kept: Record<string, ProjectLut> = {};
  for (const lut of luts) {
    try {
      decodedLuts.set(lut.id, decodeLut(lut.size, lut.data));
      kept[lut.id] = lut;
    } catch {
      notify('error', `The LUT "${lut.name}" is damaged and was left out.`);
    }
  }
  set({ luts: kept });
  renderer.setLuts(lutsFor());
}

/**
 * Import a `.cube` file into the project. Returns its id, or null (with a
 * message) if the file can't be read. Saved with the project; not an undo step.
 */
export async function importLut(file: File): Promise<string | null> {
  let parsed: ReturnType<typeof parseCube>;
  try {
    parsed = parseCube(await file.text());
  } catch (error) {
    notify('error', `Couldn’t use ${file.name}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  const id = crypto.randomUUID();
  const name = cleanLutName(parsed.title ?? file.name.replace(/\.cube$/i, '')) ?? 'LUT';
  // Store at 16-bit precision, and render from exactly what was stored.
  addLuts([{ id, name, size: parsed.lut.size, data: encodeLut(parsed.lut) }]);
  return id;
}

/** Add LUTs to the project (skipping ones it has), and tell the renderer. */
function addLuts(luts: readonly ProjectLut[]) {
  const added = luts.filter((lut) => !get().luts[lut.id]);
  if (added.length === 0) return;
  for (const lut of added) decodedLuts.set(lut.id, decodeLut(lut.size, lut.data));
  set((s) => ({ luts: { ...s.luts, ...Object.fromEntries(added.map((l) => [l.id, l])) } }));
  renderer.setLuts(lutsFor());
  emit({ type: 'changed' });
}

/**
 * LUTs removed from the project this session. Undo, redo or a paste can bring
 * back a clip that uses one; it's then restored. (Undo history doesn't survive
 * a reload, so nothing saved can refer to a removed LUT.)
 */
const removedLuts = new Map<string, ProjectLut>();

/** Put back any removed LUT that a clip on the timeline uses again. */
function restoreReferencedLuts() {
  const { timeline, luts } = get();
  const missing = [...lutUsage(timeline).keys()].filter((id) => !luts[id] && removedLuts.has(id));
  if (missing.length === 0) return;
  addLuts(missing.map((id) => removedLuts.get(id)!));
  for (const id of missing) removedLuts.delete(id);
}

/** Rename a project LUT (an empty name is ignored). */
export function renameLut(id: string, name: string): void {
  const lut = get().luts[id];
  const cleaned = cleanLutName(name);
  if (!lut || !cleaned || cleaned === lut.name) return;
  set((s) => ({ luts: { ...s.luts, [id]: { ...lut, name: cleaned } } }));
  emit({ type: 'changed' });
}

/**
 * Remove LUTs from the project. Only LUTs no clip uses can go (returns false
 * with a message otherwise). Not an undo step, but see `removedLuts`.
 */
export function removeLuts(ids: readonly string[]): boolean {
  const { luts, timeline } = get();
  const usage = lutUsage(timeline);
  const used = ids.filter((id) => usage.has(id));
  if (used.length > 0) {
    notify('info', 'That LUT is still used by a clip. Remove it from those clips first.');
    return false;
  }
  const remaining = { ...luts };
  for (const id of ids) {
    const lut = luts[id];
    if (!lut) continue;
    removedLuts.set(id, lut);
    decodedLuts.delete(id);
    delete remaining[id];
  }
  set({ luts: remaining });
  renderer.setLuts(lutsFor());
  emit({ type: 'changed' });
  return true;
}

/** Remove every LUT no clip uses. Returns how many were removed. */
export function removeUnusedLuts(): number {
  const usage = lutUsage(get().timeline);
  const unused = Object.keys(get().luts).filter((id) => !usage.has(id));
  if (unused.length > 0) removeLuts(unused);
  return unused.length;
}

/**
 * Replace the editor contents with a project. Media with no file is marked
 * missing; its clips stay on the timeline (black and silent) until relinked.
 * Throws if the timeline is invalid, leaving the current project untouched.
 */
export async function loadProject(project: {
  timeline: unknown;
  assets: ProjectAsset[];
  luts: readonly ProjectLut[];
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
    selectedClipIds: [],
    view: { pxPerSecond: 60, scrollUs: 0, scrollY: 0 },
  });
  setProjectLuts(project.luts);
  refresh();

  // Re-open the media in the workers.
  await Promise.all(
    project.assets.map(async (saved) => {
      const { id } = saved;
      const file = project.files.get(id);
      if (!file) return;
      try {
        const probed = await probeAsset(id, file);
        assetFiles.set(id, file);
        // The stored copy is named after the asset id: keep the original file's
        // name and details from the project, and take only the media facts.
        const asset: EditorAsset = {
          ...probed,
          name: saved.name,
          type: saved.type,
          size: saved.size,
          lastModified: saved.lastModified,
        };
        set((s) => ({ assets: { ...s.assets, [id]: asset } }));
      } catch {
        // Unreadable stored copy: leave it marked missing so the user can relink.
      }
    }),
  );
  requestFrame();
}

/** What an export needs: the saved project and the files its clips use. */
/** The file behind an asset (null if it's missing). */
export const assetFile = (assetId: string): File | null => assetFiles.get(assetId) ?? null;

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
  const luts = lutsFor(
    get().timeline.tracks.flatMap((t) => t.clips.flatMap((c) => (c.lut ? [c.lut.lutId] : []))),
  );
  return { projectJson: e.save(), assets, luts, baseName, durationUs: e.duration(), missing };
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

/** Select just this clip (or nothing). */
export const selectClip = (clipId: number | null) =>
  set({ selectedClipId: clipId, selectedClipIds: clipId === null ? [] : [clipId] });

/** Add a clip to the selection, or take it out (Ctrl/⌘/Shift-click). */
export function toggleClipSelection(clipId: number): void {
  const { selectedClipIds } = get();
  const ids = selectedClipIds.includes(clipId)
    ? selectedClipIds.filter((id) => id !== clipId)
    : [...selectedClipIds, clipId];
  set({ selectedClipIds: ids, selectedClipId: ids.at(-1) ?? null });
}

/** Replace the selection (the panel keeps its clip if it's still selected). */
export function setSelection(ids: number[]): void {
  const { selectedClipId } = get();
  const primary = selectedClipId !== null && ids.includes(selectedClipId) ? selectedClipId : null;
  set({ selectedClipIds: ids, selectedClipId: primary ?? ids.at(-1) ?? null });
}

/** Select every clip on the timeline (Ctrl/⌘+A). */
export function selectAll(): void {
  setSelection(get().timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

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

/**
 * Delete the selected clips (one undo step). With ripple (the toggle, or
 * Shift+Delete), the later clips on each track move back to close the space.
 */
export function deleteSelected({ ripple = get().ripple }: { ripple?: boolean } = {}) {
  const { selectedClipIds, timeline } = get();
  if (selectedClipIds.length === 0) return;
  // Latest first, so each ripple only moves clips that are still to the right of it.
  const starts = new Map(timeline.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.start])));
  const ids = [...selectedClipIds].sort((a, b) => (starts.get(b) ?? 0) - (starts.get(a) ?? 0));
  const removed = edit((e) => {
    for (const id of ids) {
      if (ripple) e.rippleDelete(id);
      else e.removeClip(id);
    }
    e.pruneEmptyTracks(); // same undo step: undo brings the track back too
  });
  if (removed) selectClip(null);
}

/** Move the selected clips by `delta` µs, keeping their tracks (one undo step). */
export function moveSelection(delta: number): boolean {
  const ids = get().selectedClipIds;
  return ids.length > 0 && edit((e) => e.moveClips(ids, delta));
}

// ---------------------------------------------------------------- clipboard

/**
 * Copied clips, kept in memory for this tab, with the LUTs they use, so a
 * paste into another project (or after removing a LUT) still grades them.
 * Pasting across projects works for titles and media both projects have.
 */
let clipboard: { clips: CopiedClip[]; luts: ProjectLut[] } | null = null;

/** Copy the selected clips (Ctrl/⌘+C). */
export function copySelected(): boolean {
  const ids = get().selectedClipIds;
  if (ids.length === 0) return false;
  const clips = requireEngine().copyClips(ids);
  const { luts } = get();
  const lutIds = new Set(clips.flatMap((c) => (c.clip.lut ? [c.clip.lut.lutId] : [])));
  clipboard = { clips, luts: [...lutIds].flatMap((id) => (luts[id] ? [luts[id]] : [])) };
  notify('info', ids.length === 1 ? 'Copied 1 clip.' : `Copied ${ids.length} clips.`);
  return true;
}

/**
 * Duplicate the selection right after itself (Ctrl/⌘+D), keeping spacing and
 * tracks, and select the copies. With ripple on, the copies are inserted:
 * later clips on those tracks move along. Otherwise, like paste, they go on a
 * new track where the space is taken. One undo step; the clipboard is untouched.
 */
export function duplicateSelected(): void {
  const { selectedClipIds, timeline, ripple } = get();
  if (selectedClipIds.length === 0) return;
  const selected = timeline.tracks.flatMap((t) =>
    t.clips.filter((c) => selectedClipIds.includes(c.id)).map((clip) => ({ clip, track: t.id })),
  );
  const start = Math.min(...selected.map(({ clip }) => clip.start));
  const end = Math.max(...selected.map(({ clip }) => clipEnd(clip)));
  let ids: number[] = [];
  const duplicated = edit((e) => {
    const copied = e.copyClips(selectedClipIds);
    if (ripple) e.insertSpace([...new Set(selected.map((s) => s.track))], end, end - start);
    ids = e.pasteClips(copied, end);
  });
  if (duplicated) set({ selectedClipIds: ids, selectedClipId: ids.at(-1) ?? null });
}

/**
 * Cut silent stretches out of clips, closing each gap on the clip's track (a
 * ripple delete), as one undo step. `silences` are [start, end) ranges in
 * timeline µs per clip, as analysed. Returns how many were cut and how much
 * time that saved, or null if nothing could be cut.
 */
export function removeSilences(
  silences: readonly { clipId: number; ranges: readonly (readonly [number, number])[] }[],
): { count: number; removedUs: number } | null {
  const clips = new Map(get().timeline.tracks.flatMap((t) => t.clips.map((c) => [c.id, c])));
  // Latest first: a ripple only moves what's to its right, so every cut still
  // to come (earlier on its track) keeps the position it was analysed at.
  const work = silences
    .filter((s) => clips.has(s.clipId) && s.ranges.length > 0)
    .sort((a, b) => clips.get(b.clipId)!.start - clips.get(a.clipId)!.start);
  let count = 0;
  let removedUs = 0;
  const changed = edit((e) => {
    for (const { clipId, ranges } of work) {
      const clip = clips.get(clipId)!;
      let end = clipEnd(clip); // where the clip's remaining left part ends
      for (const [from, to] of [...ranges].sort((a, b) => b[0] - a[0])) {
        // A cut within a hair of an edge goes to the edge (the engine keeps no sliver clips).
        let start = Math.max(clip.start, Math.round(from));
        let stop = Math.min(end, Math.round(to));
        if (start - clip.start < MIN_CUT_US) start = clip.start;
        if (end - stop < MIN_CUT_US) stop = end;
        if (stop - start < MIN_CUT_US) continue;
        if (stop < end) e.splitClip(clipId, stop);
        const silent = start > clip.start ? e.splitClip(clipId, start) : clipId;
        e.rippleDelete(silent);
        count++;
        removedUs += stop - start;
        if (silent === clipId) break; // the clip started with silence: nothing is left before it
        end = start;
      }
    }
  });
  return changed && count > 0 ? { count, removedUs } : null;
}

/** Cuts (and pieces) shorter than this aren't made: the engine's shortest clip. */
const MIN_CUT_US = 10_000;

/** Copy, then delete (Ctrl/⌘+X; ripples if ripple editing is on). */
export function cutSelected(): void {
  if (copySelected()) deleteSelected();
}

/**
 * Paste at the playhead (Ctrl/⌘+V), keeping the clips' spacing and tracks;
 * where a track has no room, the engine adds a new one. The pasted clips
 * become the selection.
 */
export function paste(): void {
  if (!clipboard) {
    notify('info', 'Nothing to paste yet: select clips and copy them first.');
    return;
  }
  const { assets, playhead } = get();
  const usable = clipboard.clips.filter((c) => c.clip.text || assets[c.clip.assetId]);
  if (usable.length < clipboard.clips.length) {
    notify(
      'info',
      'Some copied clips use media that isn’t in this project, so they were left out.',
    );
  }
  if (usable.length === 0) return;
  addLuts(clipboard.luts); // before the paste renders; ones the project has are skipped
  let ids: number[] = [];
  const pasted = edit((e) => {
    ids = e.pasteClips(usable, playhead);
  });
  if (pasted) set({ selectedClipIds: ids, selectedClipId: ids.at(-1) ?? null });
}

// ---------------------------------------------------------------- keyboard editing

/** Say something to screen-reader users (the timeline's live region). */
export function announce(text: string): void {
  set({ announcement: text });
}

/** "red.webm on Video 1, 00:06:00 to 00:09:00", for announcements. */
export function describeClip(clipId: number): string {
  const { timeline, assets } = get();
  const track = timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return '';
  const name = clip.text ? `text “${clip.text.text}”` : (assets[clip.assetId]?.name ?? 'clip');
  const where = trackNames(timeline).get(track.id);
  return `${name} on ${where}, ${formatTimecode(clip.start)} to ${formatTimecode(clipEnd(clip))}`;
}

/** Nudges since Alt went down: undone together (see `endNudge`). */
let nudging = false;

/**
 * Move the selection by whole frames (Alt+Left/Right), landing the main clip
 * on the frame grid. Nudges made while Alt stays down are one undo step.
 * Returns false if it can't move (another clip, or the start of the timeline).
 */
export function nudgeSelection(frames: number): boolean {
  const { selectedClipIds, selectedClipId } = get();
  const main = clipsByIds(selectedClipId === null ? [] : [selectedClipId])[0];
  if (!main) return false;
  const target = framesToMicros(microsToFrames(main.start) + frames);
  if (!nudging) {
    beginGesture();
    nudging = true;
  }
  const moved = updateGesture((e) => e.moveClips(selectedClipIds, target - main.start));
  announce(
    moved
      ? `${describeClip(main.id)}.`
      : 'Can’t move further: another clip or the start of the timeline is in the way.',
  );
  return moved;
}

/** Alt released (or focus lost): close the nudges' undo step. */
export function endNudge(): void {
  if (!nudging) return;
  nudging = false;
  endGesture();
}

/**
 * Move the selected clip to the track above or below (Alt+Up/Down) of its
 * kind; past the top video track or the bottom audio track, onto a new one.
 */
export function moveSelectionToTrack(direction: -1 | 1): boolean {
  const { selectedClipIds, selectedClipId, timeline } = get();
  if (selectedClipIds.length !== 1 || selectedClipId === null) {
    if (selectedClipIds.length > 1) notify('info', 'Select one clip to move it to another track.');
    return false;
  }
  const rows = trackRows(timeline);
  const row = rows.findIndex((t) => t.clips.some((c) => c.id === selectedClipId));
  const track = rows[row]!;
  const clip = track.clips.find((c) => c.id === selectedClipId)!;
  let target: { trackId: number } | { newTrack: TrackKind } | null = null;
  for (let r = row + direction; r >= 0 && r < rows.length; r += direction) {
    if (rows[r]!.kind === track.kind) {
      target = { trackId: rows[r]!.id };
      break;
    }
  }
  // Rows are top-down: video tracks above audio tracks.
  if (
    !target &&
    ((track.kind === 'video' && direction < 0) || (track.kind === 'audio' && direction > 0))
  ) {
    target = { newTrack: track.kind };
  }
  if (!target) return false;
  const moved = moveClip(clip.id, clip.start, target);
  if (moved) announce(`${describeClip(clip.id)}.`);
  return moved;
}

/**
 * Trim the selected clips under the playhead so they start or end there (`[`
 * and `]`), as one undo step. With ripple, each clip keeps its place and the
 * rest of its track follows, like a ripple trim with the mouse.
 */
export function trimSelectedToPlayhead(edge: 'start' | 'end'): boolean {
  const { selectedClipIds, playhead, ripple } = get();
  const clips = clipsByIds(selectedClipIds).filter(
    (c) => c.start < playhead && playhead < clipEnd(c),
  );
  if (clips.length === 0) {
    if (selectedClipIds.length > 0) {
      notify('info', 'Move the playhead inside the selected clip to trim it there.');
    }
    return false;
  }
  const trimmed = edit((e) => {
    for (const c of clips) {
      if (ripple) e.trimClipRipple(c.id, edge, playhead);
      else e.trimClip(c.id, edge, playhead);
    }
  });
  if (trimmed) announce(`${describeClip(clips.at(-1)!.id)}.`);
  return trimmed;
}

export function setRipple(on: boolean): void {
  set({ ripple: on });
  try {
    globalThis.localStorage?.setItem(RIPPLE_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered, but still on for this session.
  }
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

/**
 * Add recognised captions as titles on a new top video track, in one undo
 * step, styled to be readable over any picture (smaller than a title, on a
 * dark box, near the bottom, no fades). Returns the new track's id.
 */
export function addCaptions(
  captions: readonly Caption[],
  { highlight = true }: { highlight?: boolean } = {},
): number | null {
  let trackId: number | null = null;
  const added = edit((e) => {
    const defaults = e.defaultTextStyle();
    const style = {
      ...defaults,
      size: 52,
      background: '#000000b3',
      y: 880,
      animationIn: 'none' as const,
      animationOut: 'none' as const,
      // Each word turns this colour as it's spoken (and can be changed or removed per caption).
      ...(highlight ? { highlight: CAPTION_HIGHLIGHT } : {}),
    };
    trackId = e.addTrack('video');
    for (const c of captions) {
      e.addTextClip(trackId, c.startUs, c.endUs - c.startUs, {
        text: c.text,
        style,
        words: c.words,
      });
    }
  });
  return added ? trackId : null;
}

/**
 * Add a translation of a caption track as a new top track, in one undo step:
 * each title keeps its time and style, with `texts[i]` (in the track's time
 * order) as its text. Word timings belong to the original words, so the
 * translation has none (and no word highlight). With `bilingual`, the original
 * captions move up to make room and the translation shows under them
 * (`bilingualStyles`), in the same undo step. Returns the new track's id.
 */
export function addTranslatedCaptions(
  sourceTrackId: number,
  texts: readonly string[],
  { bilingual = false }: { bilingual?: boolean } = {},
): number | null {
  const source = captionClips(sourceTrackId);
  if (source.length !== texts.length) return null;
  let trackId: number | null = null;
  const added = edit((e) => {
    trackId = e.addTrack('video');
    source.forEach((clip, i) => {
      const content = clip.text!;
      const { highlight: _, ...plain } = content.style;
      let style: TextStyle = plain;
      if (bilingual) {
        const styles = bilingualStyles(content.style);
        e.setClipText(clip.id, { ...content, style: styles.original });
        style = styles.translation;
      }
      const text = texts[i]!.trim() || content.text; // never an empty title
      e.addTextClip(trackId!, clip.start, clip.duration, { text: wrapLines(text), style });
    });
  });
  return added ? trackId : null;
}

/**
 * The other tracks with titles on them, the one whose timing best matches
 * `trackId`'s first (for a translation: its original, or the reverse).
 */
export function captionPartners(trackId: number): number[] {
  const mine = captionClips(trackId);
  const overlap = (other: number) =>
    captionClips(other).reduce(
      (total, b) =>
        total +
        mine.reduce(
          (sum, a) =>
            sum + Math.max(0, Math.min(clipEnd(a), clipEnd(b)) - Math.max(a.start, b.start)),
          0,
        ),
      0,
    );
  return get()
    .timeline.tracks.filter((t) => t.id !== trackId && t.clips.some((c) => c.text))
    .map((t) => ({ id: t.id, overlap: overlap(t.id) }))
    .sort((a, b) => b.overlap - a.overlap)
    .map((t) => t.id);
}

/**
 * Two caption tracks as one bilingual file: the track shown higher on screen
 * (for bilingual captions, the original) gives each line pair its first line.
 */
export function bilingualCaptions(trackA: number, trackB: number): CaptionCue[] {
  const height = (trackId: number) => {
    const clips = captionClips(trackId);
    return clips.reduce((sum, c) => sum + c.text!.style.y, 0) / Math.max(1, clips.length);
  };
  const [first, second] = height(trackA) <= height(trackB) ? [trackA, trackB] : [trackB, trackA];
  return combineCues(trackCaptions(first), trackCaptions(second));
}

/** A track's titles in time order. */
export function captionClips(trackId: number): Clip[] {
  const track = get().timeline.tracks.find((t) => t.id === trackId);
  return (track?.clips ?? []).filter((c) => c.text).sort((a, b) => a.start - b.start);
}

/** The default colour of the word being spoken in a caption. */
export const CAPTION_HIGHLIGHT = '#facc15';

/** A track's titles as captions (for .srt / .vtt files), in time order. */
export function trackCaptions(trackId: number): CaptionCue[] {
  return captionClips(trackId).map((c) => ({
    text: c.text!.text,
    startUs: c.start,
    endUs: clipEnd(c),
  }));
}

/**
 * Replace a clip's animation with `keyframes` (e.g. from reframing), as one
 * undo step. Its still transform becomes the first keyframe's, so removing
 * the keyframes later leaves the clip filling the frame.
 */
export function setClipAnimation(clipId: number, keyframes: readonly Keyframe[]): boolean {
  if (keyframes.length === 0) return false;
  return edit((e) => {
    e.clearKeyframes(clipId);
    e.setClipTransform(clipId, keyframes[0]!.transform);
    for (const k of keyframes) e.setKeyframe(clipId, k.sourceTime, k.transform);
  });
}

/** Change the frame's shape (one undo step). Positions are relative, so the layout carries over. */
export function setAspect(aspect: AspectRatio): boolean {
  if (aspectOf(get().timeline) === aspect) return true;
  return edit((e) => e.setAspect(aspect));
}

/**
 * Replace a text clip's content and style (validated by the engine). Word
 * timings (from captions) belong to the words they were recognised for: an
 * edit that keeps the number of words (fixing a misheard word) keeps them; one
 * that adds or removes words drops them, since there's no honest way to time
 * the new words.
 */
export function updateText(clipId: number, content: TextContent): boolean {
  const words = content.words ?? [];
  const dropWords = words.length > 0 && countWords(content.text) !== words.length;
  const next = dropWords ? { ...content, words: [] } : content;
  const changed = edit((e) => e.setClipText(clipId, next));
  if (changed && dropWords) {
    notify('info', 'Word highlighting was removed because the number of words changed.');
  }
  return changed;
}

/** Words as the engine counts them (split on whitespace). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The clip a drag on the preview moves: the selected clip if it's visible at
 * the playhead, otherwise the topmost visible one. Only visual clips (titles
 * and video) can be moved.
 */
export function previewDragTarget(state: EditorState = get()): Clip | null {
  const { timeline, playhead, assets, selectedClipId } = state;
  const visible = trackRows(timeline)
    .filter((t) => t.kind === 'video')
    .flatMap((t) => t.clips)
    .filter((c) => c.start <= playhead && playhead < clipEnd(c))
    .filter((c) => c.text || assets[c.assetId]?.hasVideo);
  return visible.find((c) => c.id === selectedClipId) ?? visible[0] ?? null;
}

/** Set or clear (null) the transition from the clip directly before. */
export function setClipTransition(clipId: number, transition: Transition | null): boolean {
  return edit((e) => e.setClipTransition(clipId, transition));
}

/**
 * The clip a transition into `clip` would come from: the one directly before
 * it on the same track, touching it, and not a title. Null if there is none.
 */
export function previousClip(clip: Clip, timeline: TimelineSnapshot): Clip | null {
  for (const track of timeline.tracks) {
    const index = track.clips.findIndex((c) => c.id === clip.id);
    if (index < 0) continue;
    const before = track.clips[index - 1];
    return before && clipEnd(before) === clip.start && !before.text ? before : null;
  }
  return null;
}

// ---------------------------------------------------------------- transforms and keyframes

const MOVE_PLAYHEAD = 'Move the playhead over the clip to change its animation.';

function clipById(clipId: number): Clip | undefined {
  return get()
    .timeline.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === clipId);
}

/**
 * Write a clip's transform as it should look at timeline time `at`: once the
 * clip is animated, into its keyframe there (added if needed); otherwise into
 * the static transform. Throws if an animated clip isn't under `at`.
 */
export function writeTransform(e: TimelineEngine, clip: Clip, transform: Transform, at: Micros) {
  if (!clip.keyframes?.length) {
    e.setClipTransform(clip.id, transform);
    return;
  }
  if (!coversTime(clip, at)) throw new Error(MOVE_PLAYHEAD);
  const key = keyframeAt(clip, at);
  e.setKeyframe(clip.id, key?.sourceTime ?? sourceTimeAt(clip, at), transform);
}

/** Change a clip's transform at `at` (the playhead by default), keyframing it if animated. */
export function setClipTransform(
  clipId: number,
  transform: Transform,
  at: Micros = get().playhead,
): boolean {
  const clip = clipById(clipId);
  if (!clip) return false;
  if (clip.keyframes?.length && !coversTime(clip, at)) {
    notify('info', MOVE_PLAYHEAD);
    return false;
  }
  return edit((e) => writeTransform(e, clip, transform, at));
}

/** A media clip's transform at timeline time `at`, as the preview shows it (fractional). */
export function clipTransformAt(clipId: number, at: Micros): Transform {
  return requireEngine().clipTransformAt(clipId, at);
}

/**
 * Add a keyframe at the playhead holding the clip's current look, or remove
 * the one there. Removing the last keyframe keeps the clip as it looked.
 */
export function toggleKeyframe(clipId: number): boolean {
  const clip = clipById(clipId);
  const at = get().playhead;
  if (!clip) return false;
  if (!coversTime(clip, at)) {
    notify('info', 'Move the playhead over the clip to add a keyframe.');
    return false;
  }
  const existing = keyframeAt(clip, at);
  return edit((e) => {
    if (existing) {
      if (clip.keyframes!.length === 1) e.setClipTransform(clipId, existing.transform);
      e.removeKeyframe(clipId, existing.sourceTime);
    } else {
      const current = roundTransform(e.clipTransformAt(clipId, at));
      e.setKeyframe(clipId, sourceTimeAt(clip, at), current);
    }
  });
}

/** Stop animating, keeping the clip as it looks at the playhead. */
export function clearKeyframes(clipId: number): boolean {
  const at = get().playhead;
  return edit((e) => {
    e.setClipTransform(clipId, roundTransform(e.clipTransformAt(clipId, at)));
    e.clearKeyframes(clipId);
  });
}

/** Back to centred, full size, upright and opaque, with no animation. */
export function resetTransform(clipId: number): boolean {
  return edit((e) => {
    e.clearKeyframes(clipId);
    e.setClipTransform(clipId, IDENTITY_TRANSFORM);
  });
}

export function setKeyframeEasing(clipId: number, sourceTime: Micros, easing: Easing): boolean {
  return edit((e) => e.setKeyframeEasing(clipId, sourceTime, easing));
}

/** Move the playhead to the clip's previous (-1) or next (1) keyframe. */
export function seekToKeyframe(clipId: number, direction: -1 | 1): void {
  const clip = clipById(clipId);
  if (!clip) return;
  const key = adjacentKeyframe(clip, get().playhead, direction);
  if (key) seek(timelineTimeOf(clip, key.sourceTime));
}

// ---------------------------------------------------------------- gestures

/**
 * Continuous interactions (dragging a clip on the preview) apply changes live,
 * but record a single undo step when they end. Each update is validated by the
 * engine; a rejected update leaves the last good state in place.
 */
let gestureStart: string | null = null;

export function beginGesture(): void {
  gestureStart = requireEngine().save();
}

export function updateGesture(operation: (engine: TimelineEngine) => void): boolean {
  const e = requireEngine();
  if (gestureStart === null) return false;
  const lastGood = e.save();
  try {
    operation(e);
  } catch {
    e.load(lastGood);
    return false;
  }
  refresh();
  return true;
}

/** Finish the gesture: one undo step, if anything changed. */
export function endGesture(): void {
  const e = requireEngine();
  const before = gestureStart;
  gestureStart = null;
  if (before === null || e.save() === before) return;
  undoStack.push(before);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  refresh();
  emit({ type: 'changed' });
}

/** Abandon the gesture (e.g. Escape): restore the state from before it began. */
export function cancelGesture(): void {
  const e = requireEngine();
  if (gestureStart === null) return;
  e.load(gestureStart);
  gestureStart = null;
  refresh();
}

// ---------------------------------------------------------------- clip settings, one or many clips

/**
 * Each setter below applies to every clip it's given, as one undo step, and
 * changes only the setting it's about (so changing several clips' brightness
 * keeps each one's own saturation, LUT and so on).
 */
function clipsByIds(ids: readonly number[]): Clip[] {
  const wanted = new Set(ids);
  return get().timeline.tracks.flatMap((t) => t.clips.filter((c) => wanted.has(c.id)));
}

/** Change some colour values, keeping each clip's others. */
export function setClipsColor(ids: readonly number[], patch: Partial<ColorAdjust>): boolean {
  const clips = clipsByIds(ids);
  return edit((e) => {
    for (const c of clips) e.setClipColor(c.id, { ...NEUTRAL_COLOR, ...c.color, ...patch });
  });
}

/** Apply a project LUT (or remove it, with null). */
export function setClipsLut(ids: readonly number[], lut: LutRef | null): boolean {
  return edit((e) => {
    for (const id of ids) e.setClipLut(id, lut);
  });
}

/** Change how strongly each clip's own LUT applies (clips without one are left alone). */
export function setClipsLutIntensity(ids: readonly number[], intensityPercent: number): boolean {
  const clips = clipsByIds(ids).filter((c) => c.lut);
  return edit((e) => {
    for (const c of clips) e.setClipLut(c.id, { lutId: c.lut!.lutId, intensityPercent });
  });
}

/**
 * Change playback speed (percent); each clip's length follows. With ripple,
 * later clips move along: done latest first, so every clip's shift composes.
 */
export function setClipsSpeed(ids: readonly number[], percent: number): boolean {
  const ripple = get().ripple;
  const clips = clipsByIds(ids).sort((a, b) => b.start - a.start);
  return edit((e) => {
    for (const c of clips) {
      if (ripple) e.setClipSpeedRipple(c.id, percent);
      else e.setClipSpeed(c.id, percent);
    }
  });
}

export function setClipsVolume(ids: readonly number[], percent: number): boolean {
  return edit((e) => {
    for (const id of ids) e.setClipVolume(id, percent);
  });
}

/** Turn background removal on or off for media clips (one undo step). */
export function setClipsRemoveBackground(ids: readonly number[], on: boolean): boolean {
  const clips = clipsByIds(ids).filter((c) => !c.text);
  if (clips.length === 0) return false;
  return edit((e) => {
    for (const c of clips) e.setClipRemoveBackground(c.id, on);
  });
}

/** Mute the clips, or unmute them if they're all muted already (M). */
export function toggleMuteClips(ids: readonly number[]): boolean {
  const clips = clipsByIds(ids).filter((c) => !c.text);
  if (clips.length === 0) return false;
  const mute = !clips.every((c) => c.muted);
  return edit((e) => {
    for (const c of clips) e.setClipMuted(c.id, mute);
  });
}

export function setView(view: Partial<View>) {
  set((s) => ({ view: { ...s.view, ...view } }));
}
