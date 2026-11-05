import { describe, expect, it } from 'vitest';
import { MAX_KEYFRAMES } from '../engine/types';
import {
  cameraPath,
  fillGaps,
  framingTransform,
  medianFilter,
  reframeKeyframes,
  simplify,
  subjects,
  type Face,
  type FrameFaces,
} from './path';

const face = (cx: number, cy: number, size = 0.1, score = 0.99): Face => ({
  x0: cx - size / 2,
  y0: cy - size / 2,
  x1: cx + size / 2,
  y1: cy + size / 2,
  score,
});
const at = (seconds: number, ...faces: Face[]): FrameFaces => ({
  sourceTime: seconds * 1e6,
  faces,
});
const WIDE = { width: 1920, height: 1080 };
const VERTICAL = { width: 1080, height: 1920 };
// 16:9 into 9:16: filling needs 317% (lib/aspect fillScalePercent).
const FILL = 317;

describe('subjects', () => {
  it('follows the biggest face', () => {
    const [p] = subjects([at(0, face(0.2, 0.5, 0.05), face(0.7, 0.4, 0.2))]);
    expect(p).toEqual({ x: 0.7, y: 0.4 });
  });

  it('sticks with the same person while they stay at least half as big as the biggest', () => {
    const points = subjects([
      at(0, face(0.3, 0.5, 0.2)),
      at(0.25, face(0.3, 0.5, 0.15), face(0.8, 0.5, 0.2)), // 0.15² ≥ 0.2²/2: keep
      at(0.5, face(0.3, 0.5, 0.1), face(0.8, 0.5, 0.2)), // 0.1² < 0.2²/2: switch
    ]);
    expect(points.map((p) => p!.x)).toEqual([0.3, 0.3, 0.8]);
  });

  it('has no subject where there are no faces', () => {
    expect(subjects([at(0)])).toEqual([null]);
  });
});

describe('fillGaps and medianFilter', () => {
  it('holds the last subject, uses the first one before it, and centres if none', () => {
    const p = (x: number) => ({ x, y: 0.5 });
    expect(fillGaps([null, p(0.3), null, p(0.6), null]).map((q) => q.x)).toEqual([
      0.3, 0.3, 0.3, 0.6, 0.6,
    ]);
    expect(fillGaps([null, null])).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ]);
  });

  it('drops a one-frame glitch', () => {
    const xs = [0.3, 0.3, 0.9, 0.3, 0.3].map((x) => ({ x, y: 0.5 }));
    expect(medianFilter(xs).map((p) => p.x)).toEqual([0.3, 0.3, 0.3, 0.3, 0.3]);
  });
});

describe('cameraPath', () => {
  const times = (n: number) => Array.from({ length: n }, (_, i) => i * 250_000);
  const xs = (...values: number[]) => values.map((x) => ({ x, y: 0.5 }));

  it('stays still while the subject moves within the dead zone', () => {
    const { points } = cameraPath(times(4), xs(0.5, 0.51, 0.49, 0.52));
    expect(points.every((p) => p.x === 0.5)).toBe(true);
  });

  it('eases towards a subject that moves, without overshooting', () => {
    const { points, cuts } = cameraPath(times(8), xs(0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5));
    expect(cuts).toEqual([]);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x).toBeGreaterThanOrEqual(points[i - 1]!.x);
      expect(points[i]!.x).toBeLessThanOrEqual(0.5);
    }
    expect(points.at(-1)!.x).toBeGreaterThan(0.45); // most of the way after 1.75 s
  });

  it('jumps at once to a subject far away (a new shot)', () => {
    const { points, cuts } = cameraPath(times(3), xs(0.2, 0.2, 0.8));
    expect(cuts).toEqual([2]);
    expect(points[2]!.x).toBe(0.8);
  });
});

describe('simplify', () => {
  it('keeps only the ends of a straight path', () => {
    const t = [0, 1, 2, 3, 4];
    const p = t.map((i) => ({ x: 0.2 + i * 0.1, y: 0.5 }));
    expect(simplify(t, p, [], 0.01)).toEqual([0, 4]);
  });

  it('keeps the bends, and both sides of every cut', () => {
    const t = [0, 1, 2, 3, 4, 5];
    const p = [0.2, 0.3, 0.4, 0.4, 0.8, 0.8].map((x) => ({ x, y: 0.5 }));
    expect(simplify(t, p, [4], 0.01)).toEqual([0, 2, 3, 4, 5]);
  });
});

describe('framingTransform', () => {
  it('centres the subject in the frame', () => {
    // A subject a quarter of the way across the picture.
    const t = framingTransform({ x: 0.25, y: 0.5 }, WIDE, VERTICAL, FILL);
    // The clip is 3.17 frames wide: the subject is 0.25 × 3.17 = 0.79 frames left of the
    // clip's centre, so the clip's centre goes 0.79 frames right of the frame's centre.
    expect(t.x).toBe(Math.round(500 + 0.25 * 3.17 * 1000));
    expect(t.y).toBe(500); // no overflow vertically: no movement
    expect(t.scalePercent).toBe(FILL);
  });

  it('never uncovers the frame: the clip stops at its edges', () => {
    const left = framingTransform({ x: 0, y: 0.5 }, WIDE, VERTICAL, FILL);
    const right = framingTransform({ x: 1, y: 0.5 }, WIDE, VERTICAL, FILL);
    const slack = ((3.17 - 1) / 2) * 1000;
    expect(left.x).toBe(Math.round(500 + slack));
    expect(right.x).toBe(Math.round(500 - slack));
  });
});

describe('reframeKeyframes', () => {
  it('follows a face moving across the picture, with few keyframes', () => {
    const frames = Array.from({ length: 25 }, (_, i) => at(i * 0.25, face(0.2 + i * 0.025, 0.5)));
    const keys = reframeKeyframes(frames, WIDE, VERTICAL, FILL);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.length).toBeLessThan(10);
    expect(keys[0]!.sourceTime).toBe(0);
    // Moving right in the picture: the clip moves left in the frame.
    const xs = keys.map((k) => k.transform.x);
    expect(xs[0]).toBeGreaterThan(xs.at(-1)!);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]!.sourceTime).toBeGreaterThan(keys[i - 1]!.sourceTime);
    }
  });

  it('cuts to a new subject with keyframes a millisecond apart', () => {
    const frames = [
      ...Array.from({ length: 8 }, (_, i) => at(i * 0.25, face(0.2, 0.5))),
      ...Array.from({ length: 8 }, (_, i) => at(2 + i * 0.25, face(0.8, 0.5))),
    ];
    const keys = reframeKeyframes(frames, WIDE, VERTICAL, FILL);
    const jump = keys.findIndex((k) => k.sourceTime === 2e6);
    expect(jump).toBeGreaterThan(0);
    expect(keys[jump - 1]!.sourceTime).toBe(2e6 - 1000);
    expect(keys[jump - 1]!.transform.x).toBeGreaterThan(keys[jump]!.transform.x);
  });

  it('never makes more keyframes than a clip can hold', () => {
    // A face jittering wildly for 2 minutes.
    const frames = Array.from({ length: 480 }, (_, i) =>
      at(i * 0.25, face(0.3 + 0.2 * Math.sin(i * 0.7) * Math.sin(i * 0.13), 0.5)),
    );
    expect(reframeKeyframes(frames, WIDE, VERTICAL, FILL).length).toBeLessThanOrEqual(
      MAX_KEYFRAMES,
    );
  });
});
