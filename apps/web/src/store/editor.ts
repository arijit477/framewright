import { create } from 'zustand';
import { AudioOutput } from '../audio/client';
import { TimelineEngine } from '../engine/engine';
import { clipEnd, type Clip, type TimelineSnapshot } from '../engine/types';
import { framesToMicros, microsToFrames } from '../lib/time';
import { RenderClient } from '../render/client';
import type { AssetInfo, RendererBackend } from '../render/protocol';
import type { View } from '../timeline/geometry';

const MAX_HISTORY = 100;

export interface EditorState {
  ready: boolean;
  timeline: TimelineSnapshot;
  duration: number;
  assets: Record<string, AssetInfo>;
  /** Waveform peaks per asset (see audio/protocol.ts PEAKS_PER_SECOND). */
  peaks: Record<string, Float32Array>;
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
  playhead: 0,
  playing: false,
  selectedClipId: null,
  view: { pxPerSecond: 60, scrollUs: 0 },
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

/** Source files by asset id, kept so exports can re-read the media. */
const assetFiles = new Map<string, File>();

const undoStack: string[] = [];
const redoStack: string[] = [];

export async function initEditor(): Promise<void> {
  if (engine) return;
  engine = await TimelineEngine.create();
  engine.addTrack('video');
  engine.addTrack('audio');
  set({ ready: true, audioClock: audio.available });
  refresh();
}

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
 * Run an editing operation with undo support. The engine validates every edit;
 * if it rejects one, the timeline is left untouched and the reason is shown.
 */
export function edit(operation: (engine: TimelineEngine) => void): boolean {
  const e = requireEngine();
  const before = e.save();
  try {
    operation(e);
  } catch (error) {
    notify('error', error instanceof Error ? error.message : String(error));
    return false;
  }
  undoStack.push(before);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  refresh();
  return true;
}

export function undo() {
  const e = requireEngine();
  const previous = undoStack.pop();
  if (previous === undefined) return;
  redoStack.push(e.save());
  e.load(previous);
  set({ selectedClipId: null });
  refresh();
}

export function redo() {
  const e = requireEngine();
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(e.save());
  e.load(next);
  refresh();
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
      // Video and audio are probed in parallel by their own workers.
      const [visual, sound] = await Promise.all([
        renderer.addAsset(id, file),
        audio.addAsset(id, file).catch((error: unknown) => {
          notify('error', `${file.name}: audio could not be read (${String(error)})`);
          return { hasAudio: false, durationUs: 0 };
        }),
      ]);
      if (!visual.hasVideo && !sound.hasAudio) {
        throw new Error('no playable video or audio found');
      }
      const asset: AssetInfo = {
        ...visual,
        hasAudio: sound.hasAudio,
        // Video length decides a video clip; audio-only files use the audio length.
        durationUs: visual.hasVideo ? visual.durationUs : sound.durationUs,
      };
      assetFiles.set(id, file);
      set((s) => ({ assets: { ...s.assets, [id]: asset } }));
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

/** What an export needs: the saved project and the files its clips use. */
export function projectForExport() {
  const e = requireEngine();
  const used = new Set(get().timeline.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));
  const assets = [...used].flatMap((id) => {
    const file = assetFiles.get(id);
    return file ? [{ id, file }] : [];
  });
  const firstClip = get().timeline.tracks.flatMap((t) => t.clips)[0];
  const baseName = (firstClip && get().assets[firstClip.assetId]?.name) ?? 'framewright-export';
  return { projectJson: e.save(), assets, baseName, durationUs: e.duration() };
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
  const clips = timeline.tracks.flatMap((t) => t.clips);
  const underPlayhead = (c: Clip) => c.start < playhead && playhead < clipEnd(c);
  const target =
    clips.find((c) => c.id === selectedClipId && underPlayhead(c)) ?? clips.findLast(underPlayhead);
  if (!target) {
    notify('info', 'Move the playhead over a clip to split it.');
    return;
  }
  edit((e) => e.splitClip(target.id, playhead));
}

export function deleteSelected() {
  const { selectedClipId } = get();
  if (selectedClipId === null) return;
  if (edit((e) => e.removeClip(selectedClipId))) set({ selectedClipId: null });
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
