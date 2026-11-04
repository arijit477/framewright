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
  /** Placement of a media clip; omitted when unchanged. Unused while keyframed. */
  transform?: Transform;
  /** Animation of the transform, in source-time order; omitted when none. */
  keyframes?: Keyframe[];
  /** Transition from the clip directly before (inactive unless they touch). */
  transitionIn?: Transition;
}

export type TransitionKind = 'crossfade' | 'dip' | 'slide' | 'wipe';

/** Mirrors crates/engine/src/transition.rs. */
export interface Transition {
  kind: TransitionKind;
  durationMs: number;
}

export const TRANSITION_LIMITS = { minMs: 100, maxMs: 3000 } as const;

/** A layer's part in a transition: `progress` is 0–1000. */
export interface LayerTransition {
  kind: TransitionKind;
  outgoing: boolean;
  progress: number;
}

/** Mirrors crates/engine/src/transform.rs: integers relative to the frame. */
export interface Transform {
  /** Centre, in thousandths of the frame (500 = centre). */
  x: number;
  y: number;
  scalePercent: number;
  /** Clockwise. */
  rotationDeg: number;
  opacityPercent: number;
}

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** Mirrors crates/engine/src/keyframe.rs. */
export interface Keyframe {
  /** Time in the clip's source media, so it stays with the picture when trimmed. */
  sourceTime: Micros;
  transform: Transform;
  /** How the transform moves towards the next keyframe. */
  easing: Easing;
}

export const MAX_KEYFRAMES = 100;

export const IDENTITY_TRANSFORM: Transform = {
  x: 500,
  y: 500,
  scalePercent: 100,
  rotationDeg: 0,
  opacityPercent: 100,
};

export const TRANSFORM_LIMITS = {
  minPosition: -1000,
  maxPosition: 2000,
  minScale: 1,
  maxScale: 1000,
  maxRotation: 360,
} as const;

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
  /** Placement at this moment: fractional while keyframes animate it. */
  transform: Transform;
  /** Set while this layer is part of a transition. */
  transition?: LayerTransition;
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
  /** Fade from silence, under a transition into this clip. */
  fadeIn?: AudioFade;
  /** Fade to silence, under a transition out of this clip. */
  fadeOut?: AudioFade;
}

/** A gain ramp between two timeline times. */
export interface AudioFade {
  start: Micros;
  end: Micros;
  /** Equal power keeps loudness steady through a crossfade; linear suits dips. */
  curve: 'linear' | 'equalPower';
}

export const MAX_VOLUME_PERCENT = 200;

export const clipEnd = (clip: Clip): Micros => clip.start + clip.duration;
