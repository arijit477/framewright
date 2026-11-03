import { clipEnd, type Clip, type TimelineSnapshot } from '../engine/types';
import { MICROS_PER_SECOND } from '../lib/time';

/** Layout constants for the canvas timeline, in CSS pixels. */
export const RULER_HEIGHT = 28;
export const TRACK_HEIGHT = 56;
export const TRACK_GAP = 6;
export const TRACK_PADDING_X = 12;
export const EDGE_GRAB_PX = 7;

export interface View {
  /** Zoom level. */
  pxPerSecond: number;
  /** Horizontal scroll, in timeline microseconds at the left edge. */
  scrollUs: number;
}

export const timeToX = (us: number, view: View): number =>
  TRACK_PADDING_X + ((us - view.scrollUs) / MICROS_PER_SECOND) * view.pxPerSecond;

export const xToTime = (x: number, view: View): number =>
  view.scrollUs + ((x - TRACK_PADDING_X) / view.pxPerSecond) * MICROS_PER_SECOND;

export const trackTop = (index: number): number =>
  RULER_HEIGHT + TRACK_GAP + index * (TRACK_HEIGHT + TRACK_GAP);

export type Hit =
  | { kind: 'ruler' }
  | { kind: 'clip'; clip: Clip; trackId: number; edge: 'start' | 'end' | null }
  | { kind: 'track'; trackId: number }
  | { kind: 'none' };

/** What is under the pointer at (x, y)? Edges win over the clip body so trimming is easy. */
export function hitTest(timeline: TimelineSnapshot, view: View, x: number, y: number): Hit {
  if (y < RULER_HEIGHT) return { kind: 'ruler' };
  for (const [index, track] of timeline.tracks.entries()) {
    const top = trackTop(index);
    if (y < top || y > top + TRACK_HEIGHT) continue;
    for (const clip of track.clips) {
      const left = timeToX(clip.start, view);
      const right = timeToX(clipEnd(clip), view);
      if (x < left - EDGE_GRAB_PX || x > right + EDGE_GRAB_PX) continue;
      // On very narrow clips, keep the middle grabbable for moving.
      const grab = Math.min(EDGE_GRAB_PX, (right - left) / 3);
      if (Math.abs(x - left) <= grab)
        return { kind: 'clip', clip, trackId: track.id, edge: 'start' };
      if (Math.abs(x - right) <= grab)
        return { kind: 'clip', clip, trackId: track.id, edge: 'end' };
      if (x >= left && x <= right) return { kind: 'clip', clip, trackId: track.id, edge: null };
    }
    return { kind: 'track', trackId: track.id };
  }
  return { kind: 'none' };
}

/** Snap a time to nearby clip edges or the playhead, if within `thresholdPx`. */
export function snap(us: number, targets: number[], view: View, thresholdPx = 8): number {
  const threshold = (thresholdPx / view.pxPerSecond) * MICROS_PER_SECOND;
  let best = us;
  let bestDistance = threshold;
  for (const target of targets) {
    const distance = Math.abs(target - us);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

/** Waveform range shown, in dBFS: quieter than this draws as a flat line. */
const WAVEFORM_FLOOR_DB = -48;

/** Map a linear peak to 0..1 bar height on a decibel scale, like pro editors do. */
export function peakToHeight(peak: number): number {
  if (peak <= 0) return 0;
  const db = 20 * Math.log10(peak);
  return Math.min(1, Math.max(0, 1 - db / WAVEFORM_FLOOR_DB));
}
