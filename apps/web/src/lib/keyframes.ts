import {
  clipEnd,
  sourceAt,
  timelineAt,
  TRANSFORM_LIMITS,
  type Clip,
  type Keyframe,
  type Micros,
  type Transform,
} from '../engine/types';
import { framesToMicros } from './time';

/**
 * Keyframe helpers for the UI. Keyframes are stored at times in the clip's
 * source media (see crates/engine/src/keyframe.rs); the editor works in
 * timeline time, so these convert, and decide which keyframe the playhead is
 * "on". Interpolation itself stays in the engine (`clipTransformAt`).
 */

/** The playhead is on a keyframe within half a preview frame of it. */
export const KEYFRAME_TOLERANCE_US = Math.floor(framesToMicros(1) / 2);

export const sourceTimeAt = sourceAt;

export const timelineTimeOf = timelineAt;

/** Whether timeline time `at` is inside the clip (end included, like the engine). */
export const coversTime = (clip: Clip, at: Micros): boolean =>
  clip.start <= at && at <= clipEnd(clip);

/** Keyframes inside the clip's current range (trimmed-off ones still shape the motion). */
export function visibleKeyframes(clip: Clip): Keyframe[] {
  const from = clip.sourceIn;
  const to = sourceAt(clip, clipEnd(clip));
  return (clip.keyframes ?? []).filter((k) => k.sourceTime >= from && k.sourceTime <= to);
}

/** The visible keyframe the playhead is on, if any (the nearest one). */
export function keyframeAt(clip: Clip, at: Micros): Keyframe | null {
  const time = sourceTimeAt(clip, at);
  let best: Keyframe | null = null;
  for (const k of visibleKeyframes(clip)) {
    const distance = Math.abs(k.sourceTime - time);
    if (distance <= KEYFRAME_TOLERANCE_US && (!best || distance < Math.abs(best.sourceTime - time)))
      best = k;
  }
  return best;
}

/** The nearest visible keyframe before (-1) or after (1) the playhead, skipping the one it's on. */
export function adjacentKeyframe(clip: Clip, at: Micros, direction: -1 | 1): Keyframe | null {
  const time = sourceTimeAt(clip, at);
  const candidates = visibleKeyframes(clip).filter((k) =>
    direction < 0
      ? k.sourceTime < time - KEYFRAME_TOLERANCE_US
      : k.sourceTime > time + KEYFRAME_TOLERANCE_US,
  );
  return (direction < 0 ? candidates.at(-1) : candidates[0]) ?? null;
}

/** An interpolated (fractional) transform as the integers the engine stores. */
export function roundTransform(t: Transform): Transform {
  const { minPosition, maxPosition, minScale, maxScale, maxRotation } = TRANSFORM_LIMITS;
  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(v)));
  return {
    x: clamp(t.x, minPosition, maxPosition),
    y: clamp(t.y, minPosition, maxPosition),
    scalePercent: clamp(t.scalePercent, minScale, maxScale),
    rotationDeg: clamp(t.rotationDeg, -maxRotation, maxRotation),
    opacityPercent: clamp(t.opacityPercent, 0, 100),
  };
}
