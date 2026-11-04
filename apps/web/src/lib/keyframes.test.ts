import { describe, expect, it } from 'vitest';
import type { Clip, Keyframe } from '../engine/types';
import { IDENTITY_TRANSFORM } from '../engine/types';
import {
  adjacentKeyframe,
  coversTime,
  keyframeAt,
  KEYFRAME_TOLERANCE_US,
  roundTransform,
  sourceTimeAt,
  timelineTimeOf,
  visibleKeyframes,
} from './keyframes';

const S = 1_000_000;
const key = (sourceTime: number): Keyframe => ({
  sourceTime,
  transform: IDENTITY_TRANSFORM,
  easing: 'linear',
});

// On the timeline at 10-14 s, showing source 2-6 s.
const clip: Clip = {
  id: 1,
  assetId: 'a',
  start: 10 * S,
  duration: 4 * S,
  sourceIn: 2 * S,
  sourceDuration: 20 * S,
  volumePercent: 100,
  muted: false,
  keyframes: [key(1 * S), key(3 * S), key(5 * S), key(6 * S), key(8 * S)],
};

describe('keyframe helpers', () => {
  it('converts between timeline and source time', () => {
    expect(sourceTimeAt(clip, 11 * S)).toBe(3 * S);
    expect(timelineTimeOf(clip, 3 * S)).toBe(11 * S);
    expect(coversTime(clip, 14 * S)).toBe(true);
    expect(coversTime(clip, 14 * S + 1)).toBe(false);
  });

  it('only shows keyframes inside the clip', () => {
    expect(visibleKeyframes(clip).map((k) => k.sourceTime)).toEqual([3 * S, 5 * S, 6 * S]);
  });

  it('finds the keyframe the playhead is on, within half a frame', () => {
    expect(keyframeAt(clip, 11 * S)?.sourceTime).toBe(3 * S);
    expect(keyframeAt(clip, 11 * S + KEYFRAME_TOLERANCE_US)?.sourceTime).toBe(3 * S);
    expect(keyframeAt(clip, 11 * S + KEYFRAME_TOLERANCE_US + 1)).toBeNull();
    expect(keyframeAt(clip, 9 * S)).toBeNull(); // source 1 s is trimmed off
  });

  it('steps to the previous and next keyframe, skipping the current one', () => {
    expect(adjacentKeyframe(clip, 11 * S, 1)?.sourceTime).toBe(5 * S);
    expect(adjacentKeyframe(clip, 11 * S, -1)).toBeNull();
    expect(adjacentKeyframe(clip, 12 * S, -1)?.sourceTime).toBe(3 * S);
    expect(adjacentKeyframe(clip, 14 * S, 1)).toBeNull(); // 8 s is outside the clip
  });

  it('rounds and clamps interpolated values to what the engine stores', () => {
    expect(
      roundTransform({
        x: 250.6,
        y: -5000,
        scalePercent: 0.2,
        rotationDeg: 12.5,
        opacityPercent: 100.4,
      }),
    ).toEqual({ x: 251, y: -1000, scalePercent: 1, rotationDeg: 13, opacityPercent: 100 });
  });
});
