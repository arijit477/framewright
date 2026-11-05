/**
 * Smart reframing: from faces found in a clip's frames to a calm "camera"
 * path that keeps the subject in frame, as transform keyframes.
 *
 * Coordinates are fractions of the source picture (0..1, x right, y down).
 * The camera is the part of the picture the frame shows once the clip is
 * scaled to fill it; it can only move along the axis where the clip overflows.
 */
import type { Keyframe, Transform } from '../engine/types';
import { MAX_KEYFRAMES } from '../engine/types';

export interface Face {
  /** Corners, as fractions of the source picture. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
}

export interface FrameFaces {
  /** Time in the clip's source media (µs). */
  sourceTime: number;
  faces: Face[];
}

export interface Point {
  x: number;
  y: number;
}

export const REFRAME = {
  /** A face this far (fraction of the picture) from the last subject, staying there, is a new shot. */
  jump: 0.25,
  /** The camera ignores movements smaller than this (fraction of the picture), so it doesn't wobble. */
  deadZone: 0.03,
  /** How quickly the camera catches up with the subject (seconds to cover ~63% of the gap). */
  followSeconds: 0.6,
  /** Keyframes are kept only where the path bends by more than this (fraction of the picture). */
  tolerance: 0.01,
} as const;

const centre = (f: Face): Point => ({ x: (f.x0 + f.x1) / 2, y: (f.y0 + f.y1) / 2 });
const area = (f: Face) => Math.max(0, f.x1 - f.x0) * Math.max(0, f.y1 - f.y0);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The subject in each frame: the biggest face, except that the face nearest
 * the previous subject is kept while it's at least half as big (so the camera
 * doesn't flick between two people of similar size). Null where there's no face.
 */
export function subjects(frames: readonly FrameFaces[]): (Point | null)[] {
  let previous: Point | null = null;
  return frames.map(({ faces }) => {
    if (faces.length === 0) return null;
    const biggest = faces.reduce((a, b) => (area(b) > area(a) ? b : a));
    let chosen = biggest;
    if (previous) {
      const nearest = faces.reduce((a, b) =>
        distance(centre(b), previous!) < distance(centre(a), previous!) ? b : a,
      );
      if (area(nearest) >= area(biggest) / 2) chosen = nearest;
    }
    previous = centre(chosen);
    return previous;
  });
}

/** Fill frames without a face: hold the last subject (or the first one, before it); centre if none. */
export function fillGaps(points: readonly (Point | null)[]): Point[] {
  const first = points.find((p) => p) ?? { x: 0.5, y: 0.5 };
  let last = first;
  return points.map((p) => (last = p ?? last));
}

/** Median of each run of `size` points (per axis): drops one-frame detection glitches. */
export function medianFilter(points: readonly Point[], size = 5): Point[] {
  const half = Math.floor(size / 2);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  return points.map((_, i) => {
    const window = points.slice(Math.max(0, i - half), i + half + 1);
    return { x: median(window.map((p) => p.x)), y: median(window.map((p) => p.y)) };
  });
}

/**
 * The camera's path: it stays still while the subject moves within the dead
 * zone, otherwise eases towards it; a jump (a new shot, or another person)
 * is followed at once. `times` are in µs, one per point.
 */
export function cameraPath(
  times: readonly number[],
  targets: readonly Point[],
  options = REFRAME,
): { points: Point[]; cuts: number[] } {
  const points: Point[] = [];
  const cuts: number[] = []; // indices where the camera jumps
  let camera = targets[0] ?? { x: 0.5, y: 0.5 };
  targets.forEach((target, i) => {
    if (i > 0) {
      const dt = (times[i]! - times[i - 1]!) / 1e6;
      const gap = distance(target, camera);
      if (gap > options.jump) {
        camera = target;
        cuts.push(i);
      } else if (gap > options.deadZone) {
        const k = 1 - Math.exp(-dt / options.followSeconds);
        camera = {
          x: camera.x + (target.x - camera.x) * k,
          y: camera.y + (target.y - camera.y) * k,
        };
      }
    }
    points.push(camera);
  });
  return { points, cuts };
}

/**
 * The fewest points (indices) that keep the path within `tolerance`
 * (Ramer–Douglas–Peucker on each axis against time), always keeping the ends
 * and both sides of every cut.
 */
export function simplify(
  times: readonly number[],
  points: readonly Point[],
  cuts: readonly number[],
  tolerance: number,
): number[] {
  const keep = new Set<number>([0, points.length - 1]);
  for (const c of cuts) {
    keep.add(c - 1);
    keep.add(c);
  }
  const bounds = [...keep].filter((i) => i >= 0 && i < points.length).sort((a, b) => a - b);
  const rdp = (from: number, to: number) => {
    if (to - from < 2) return;
    let worst = -1;
    let worstError = tolerance;
    for (let i = from + 1; i < to; i++) {
      const t = (times[i]! - times[from]!) / (times[to]! - times[from]! || 1);
      const ex = points[from]!.x + (points[to]!.x - points[from]!.x) * t;
      const ey = points[from]!.y + (points[to]!.y - points[from]!.y) * t;
      const error = Math.max(Math.abs(points[i]!.x - ex), Math.abs(points[i]!.y - ey));
      if (error > worstError) {
        worstError = error;
        worst = i;
      }
    }
    if (worst < 0) return;
    keep.add(worst);
    rdp(from, worst);
    rdp(worst, to);
  };
  for (let k = 0; k + 1 < bounds.length; k++) {
    if (!cuts.includes(bounds[k + 1]!)) rdp(bounds[k]!, bounds[k + 1]!);
  }
  return [...keep].filter((i) => i >= 0 && i < points.length).sort((a, b) => a - b);
}

/**
 * The transform that fills the frame with the clip and puts source point
 * `camera` at the frame's centre, as far as the clip's edges allow (the frame
 * is always covered).
 */
export function framingTransform(
  camera: Point,
  source: { width: number; height: number },
  frame: { width: number; height: number },
  scalePercent: number,
): Transform {
  const fit = Math.min(frame.width / source.width, frame.height / source.height);
  const scale = scalePercent / 100;
  // The clip's size relative to the frame (≥ 1 on each axis when filling).
  const w = (source.width * fit * scale) / frame.width;
  const h = (source.height * fit * scale) / frame.height;
  const axis = (point: number, size: number) => {
    const slack = Math.max(0, (size - 1) / 2); // how far the clip's centre may move, in frames
    const offset = Math.min(slack, Math.max(-slack, (0.5 - point) * size));
    return Math.round(500 + offset * 1000);
  };
  return {
    x: axis(camera.x, w),
    y: axis(camera.y, h),
    scalePercent,
    rotationDeg: 0,
    opacityPercent: 100,
  };
}

/**
 * Keyframes that follow the subject: faces per sampled frame in, at most
 * `MAX_KEYFRAMES` keyframes out (the tolerance grows until they fit). A cut
 * is a pair of keyframes a millisecond apart, so the camera jumps rather than
 * sweeping across the picture.
 */
export function reframeKeyframes(
  frames: readonly FrameFaces[],
  source: { width: number; height: number },
  frame: { width: number; height: number },
  scalePercent: number,
  options = REFRAME,
): Keyframe[] {
  if (frames.length === 0) return [];
  const times = frames.map((f) => f.sourceTime);
  const targets = medianFilter(fillGaps(subjects(frames)));
  const { points, cuts } = cameraPath(times, targets, options);
  let tolerance: number = options.tolerance;
  let kept = simplify(times, points, cuts, tolerance);
  while (kept.length > MAX_KEYFRAMES && tolerance < 1) {
    tolerance *= 1.5;
    kept = simplify(times, points, cuts, tolerance);
  }
  const keyframes: Keyframe[] = [];
  for (const i of kept) {
    // A cut lands on its own sample time; the frame before holds until a millisecond earlier.
    const time = cuts.includes(i + 1) && kept.includes(i + 1) ? times[i + 1]! - 1000 : times[i]!;
    if (keyframes.length && time <= keyframes.at(-1)!.sourceTime) continue;
    keyframes.push({
      sourceTime: time,
      transform: framingTransform(points[i]!, source, frame, scalePercent),
      easing: 'linear',
    });
  }
  return keyframes.slice(0, MAX_KEYFRAMES);
}
