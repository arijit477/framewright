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
  /** Set for text clips (no media; `assetId` is empty). */
  text?: TextContent;
}

export type FontFamily = 'sans' | 'serif' | 'mono' | 'handwriting';
export type TextAlign = 'left' | 'center' | 'right';
export type TextAnimation = 'none' | 'fade' | 'slide' | 'pop';

/** Mirrors crates/engine/src/text.rs. Sizes are px at 1080p; positions are 0–1000. */
export interface TextStyle {
  font: FontFamily;
  size: number;
  /** `#rrggbb` */
  color: string;
  /** `#rrggbbaa`, or null for no box. */
  background: string | null;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  x: number;
  y: number;
  animationIn: TextAnimation;
  animationOut: TextAnimation;
  animationMs: number;
}

export interface TextContent {
  text: string;
  style: TextStyle;
}

export const TEXT_LIMITS = {
  maxChars: 500,
  minSize: 12,
  maxSize: 300,
  positionScale: 1000,
  maxAnimationMs: 3000,
} as const;

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
  /** Time since the clip started, and its length (for text animations). */
  clipTime: Micros;
  clipDuration: Micros;
  /** Set for text clips: drawn instead of a video frame. */
  text?: TextContent;
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
