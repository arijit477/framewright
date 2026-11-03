import init, { Engine } from '@framewright/engine';
import type { AudioSegment, Layer, TimelineSnapshot } from './types';

/**
 * Typed facade over the WASM engine. UI code talks to this, never to the
 * generated bindings directly, so the Rust API can change behind it.
 */
export class TimelineEngine {
  private constructor(private inner: Engine) {}

  static async create(): Promise<TimelineEngine> {
    await init();
    return new TimelineEngine(new Engine());
  }

  /** Load a saved project, e.g. inside a worker that renders a snapshot. */
  static async fromJson(json: string): Promise<TimelineEngine> {
    await init();
    return new TimelineEngine(Engine.fromJson(json));
  }

  /** Release the WASM memory. The engine must not be used afterwards. */
  free(): void {
    this.inner.free();
  }

  snapshot(): TimelineSnapshot {
    return this.inner.snapshot() as TimelineSnapshot;
  }

  duration(): number {
    return this.inner.duration();
  }

  resolve(at: number): Layer[] {
    return this.inner.resolve(at) as Layer[];
  }

  addTrack(kind: 'video' | 'audio'): number {
    return this.inner.addTrack(kind);
  }

  removeTrack(trackId: number): void {
    this.inner.removeTrack(trackId);
  }

  /** Remove empty tracks, keeping at least one of each kind. Returns removed ids. */
  pruneEmptyTracks(): number[] {
    return Array.from(this.inner.pruneEmptyTracks());
  }

  appendClip(trackId: number, assetId: string, sourceDuration: number): number {
    return this.inner.appendClip(trackId, assetId, sourceDuration);
  }

  moveClip(clipId: number, start: number, toTrack?: number): void {
    this.inner.moveClip(clipId, start, toTrack);
  }

  trimClip(clipId: number, edge: 'start' | 'end', at: number): void {
    this.inner.trimClip(clipId, edge, at);
  }

  splitClip(clipId: number, at: number): number {
    return this.inner.splitClip(clipId, at);
  }

  setClipVolume(clipId: number, percent: number): void {
    this.inner.setClipVolume(clipId, Math.round(percent));
  }

  setClipMuted(clipId: number, muted: boolean): void {
    this.inner.setClipMuted(clipId, muted);
  }

  /** Audible segments in `[from, to)`; defaults to the whole timeline. */
  audioSegments(from = 0, to = Number.MAX_SAFE_INTEGER): AudioSegment[] {
    return this.inner.audioSegments(from, to) as AudioSegment[];
  }

  removeClip(clipId: number): void {
    this.inner.removeClip(clipId);
  }

  /** Serialised project, used for undo history and saving. */
  save(): string {
    return this.inner.toJson();
  }

  /** Replace the whole timeline with a previously saved state. */
  load(json: string): void {
    const next = Engine.fromJson(json);
    this.inner.free();
    this.inner = next;
  }
}
