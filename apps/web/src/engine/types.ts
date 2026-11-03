/**
 * TypeScript mirrors of the Rust engine's serialised types
 * (crates/engine/src/timeline.rs). Keep the two in sync.
 * All times are integer microseconds.
 */

export type Micros = number;
export type TrackKind = 'video' | 'audio';

export interface Clip {
  id: number;
  assetId: string;
  start: Micros;
  duration: Micros;
  sourceIn: Micros;
  sourceDuration: Micros;
  /** Audio gain in percent (100 = unchanged, max 200). */
  volumePercent: number;
  muted: boolean;
}

export interface Track {
  id: number;
  kind: TrackKind;
  clips: Clip[];
}

export interface TimelineSnapshot {
  tracks: Track[];
}

/** One clip visible at a moment in time; higher trackIndex draws on top. */
export interface Layer {
  trackIndex: number;
  clipId: number;
  assetId: string;
  sourceTime: Micros;
}

/** One audible stretch of a clip, for the audio mixer. */
export interface AudioSegment {
  clipId: number;
  assetId: string;
  start: Micros;
  duration: Micros;
  sourceIn: Micros;
  /** Linear gain (1 = unchanged). */
  gain: number;
}

export const MAX_VOLUME_PERCENT = 200;

export const clipEnd = (clip: Clip): Micros => clip.start + clip.duration;
