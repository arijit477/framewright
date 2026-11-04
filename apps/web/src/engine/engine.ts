import init, { Engine } from '@framewright/engine';
import type {
  AudioSegment,
  ColorAdjust,
  CopiedClip,
  Easing,
  Layer,
  LutRef,
  Micros,
  TextContent,
  TextStyle,
  TimelineSnapshot,
  Transform,
  Transition,
} from './types';

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

  /** Trim keeping the clip's start in place; later clips on the track follow its end. */
  trimClipRipple(clipId: number, edge: 'start' | 'end', at: number): void {
    this.inner.trimClipRipple(clipId, edge, at);
  }

  splitClip(clipId: number, at: number): number {
    return this.inner.splitClip(clipId, at);
  }

  addTextClip(trackId: number, start: number, duration: number, content: TextContent): number {
    return this.inner.addTextClip(trackId, start, duration, content);
  }

  setClipText(clipId: number, content: TextContent): void {
    this.inner.setClipText(clipId, content);
  }

  setClipTransition(clipId: number, transition: Transition | null): void {
    this.inner.setClipTransition(clipId, transition);
  }

  transitionActive(trackId: number, clipId: number): boolean {
    return this.inner.transitionActive(trackId, clipId);
  }

  setClipTransform(clipId: number, transform: Transform): void {
    this.inner.setClipTransform(clipId, transform);
  }

  setClipColor(clipId: number, color: ColorAdjust): void {
    this.inner.setClipColor(clipId, color);
  }

  /** Apply a project LUT to a media clip, or remove it with `null`. */
  setClipLut(clipId: number, lut: LutRef | null): void {
    this.inner.setClipLut(clipId, lut);
  }

  /** Add or update the keyframe at `sourceTime` (in the clip's media). */
  setKeyframe(clipId: number, sourceTime: Micros, transform: Transform): void {
    this.inner.setKeyframe(clipId, sourceTime, transform);
  }

  setKeyframeEasing(clipId: number, sourceTime: Micros, easing: Easing): void {
    this.inner.setKeyframeEasing(clipId, sourceTime, easing);
  }

  removeKeyframe(clipId: number, sourceTime: Micros): void {
    this.inner.removeKeyframe(clipId, sourceTime);
  }

  /** A media clip's transform at timeline time `at` (fractional while animated). */
  clipTransformAt(clipId: number, at: Micros): Transform {
    return this.inner.clipTransformAt(clipId, at) as Transform;
  }

  clearKeyframes(clipId: number): void {
    this.inner.clearKeyframes(clipId);
  }

  /** The engine's default title style (single source of truth). */
  defaultTextStyle(): TextStyle {
    return Engine.defaultTextStyle() as TextStyle;
  }

  setClipVolume(clipId: number, percent: number): void {
    this.inner.setClipVolume(clipId, Math.round(percent));
  }

  /** Playback speed in percent (25–400); the clip's length changes to match. */
  setClipSpeed(clipId: number, percent: number): void {
    this.inner.setClipSpeed(clipId, Math.round(percent));
  }

  /** Change speed; later clips on the track follow the clip's new end. */
  setClipSpeedRipple(clipId: number, percent: number): void {
    this.inner.setClipSpeedRipple(clipId, Math.round(percent));
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

  /** Move several clips by `delta` µs, keeping their tracks (all or nothing). */
  moveClips(clipIds: number[], delta: number): void {
    this.inner.moveClips(Uint32Array.from(clipIds), delta);
  }

  /** Clips for the clipboard, starts relative to the earliest. */
  copyClips(clipIds: number[]): CopiedClip[] {
    return this.inner.copyClips(Uint32Array.from(clipIds)) as CopiedClip[];
  }

  /** Paste copied clips with the earliest at `at`; returns the new clip ids. */
  pasteClips(copied: CopiedClip[], at: number): number[] {
    return Array.from(this.inner.pasteClips(copied, at));
  }

  /** Remove a clip and move the later clips on its track back by its length. */
  rippleDelete(clipId: number): void {
    this.inner.rippleDelete(clipId);
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
