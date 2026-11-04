import {
  clipEnd,
  type Clip,
  type TimelineSnapshot,
  type Track,
  type TrackKind,
} from '../engine/types';
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
  /** Vertical scroll of the track area, in CSS pixels (the ruler stays fixed). */
  scrollY: number;
}

export const timeToX = (us: number, view: View): number =>
  TRACK_PADDING_X + ((us - view.scrollUs) / MICROS_PER_SECOND) * view.pxPerSecond;

export const xToTime = (x: number, view: View): number =>
  view.scrollUs + ((x - TRACK_PADDING_X) / view.pxPerSecond) * MICROS_PER_SECOND;

/** Top of display row `row`, accounting for vertical scroll. */
export const trackTop = (row: number, scrollY = 0): number =>
  RULER_HEIGHT + TRACK_GAP + row * (TRACK_HEIGHT + TRACK_GAP) - scrollY;

/** Height of all rows plus the ruler, unscrolled. */
export const contentHeight = (rows: number): number => trackTop(rows) + TRACK_GAP;

export const maxScrollY = (rows: number, viewportHeight: number): number =>
  Math.max(0, contentHeight(rows) - viewportHeight);

/**
 * Display order of tracks, top to bottom. The engine composites video tracks
 * with higher indices on top, so video tracks are shown in reverse (the top
 * row is the top layer, as in other editors), followed by audio tracks.
 */
export function trackRows(timeline: TimelineSnapshot): Track[] {
  const video = timeline.tracks.filter((t) => t.kind === 'video').reverse();
  const audio = timeline.tracks.filter((t) => t.kind === 'audio');
  return [...video, ...audio];
}

export type Hit =
  | { kind: 'ruler' }
  | { kind: 'clip'; clip: Clip; trackId: number; edge: 'start' | 'end' | null }
  | { kind: 'track'; trackId: number }
  | { kind: 'none' };

/** What is under the pointer at (x, y)? Edges win over the clip body so trimming is easy. */
export function hitTest(timeline: TimelineSnapshot, view: View, x: number, y: number): Hit {
  if (y < RULER_HEIGHT) return { kind: 'ruler' };
  for (const [row, track] of trackRows(timeline).entries()) {
    const top = trackTop(row, view.scrollY);
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

/** Where a dragged clip would land. */
export type DropTarget = { type: 'track'; trackId: number } | { type: 'new'; kind: TrackKind };

/**
 * The drop target for a clip of `kind` dragged to height `y`:
 * - over a track of the same kind: that track;
 * - above the top video row (video) or below the last audio row (audio): a new track;
 * - between rows of its kind: the nearest one;
 * - over tracks of the other kind: the closest track of its own kind.
 */
export function dropTarget(
  timeline: TimelineSnapshot,
  view: View,
  y: number,
  kind: TrackKind,
): DropTarget {
  const rows = trackRows(timeline);
  const own = rows.map((track, row) => ({ track, row })).filter(({ track }) => track.kind === kind);
  if (own.length === 0) return { type: 'new', kind };
  const firstTop = trackTop(own[0]!.row, view.scrollY);
  const lastBottom = trackTop(own.at(-1)!.row, view.scrollY) + TRACK_HEIGHT;
  if (kind === 'video' && y < firstTop - TRACK_GAP / 2) return { type: 'new', kind };
  if (kind === 'audio' && y > lastBottom + TRACK_GAP / 2) return { type: 'new', kind };
  // Nearest row of the same kind by vertical distance to its centre.
  let best = own[0]!;
  let bestDistance = Infinity;
  for (const candidate of own) {
    const centre = trackTop(candidate.row, view.scrollY) + TRACK_HEIGHT / 2;
    const distance = Math.abs(y - centre);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return { type: 'track', trackId: best.track.id };
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

/**
 * The span an active transition covers on the timeline, mirroring the
 * engine's rule (touching media clips; clamped to both clips' lengths).
 */
export function transitionWindow(before: Clip | undefined, clip: Clip): [number, number] | null {
  const transition = clip.transitionIn;
  if (!transition || !before || clipEnd(before) !== clip.start || clip.text || before.text)
    return null;
  const duration = Math.min(transition.durationMs * 1000, clip.duration, before.duration);
  return [clip.start - duration / 2, clip.start + duration / 2];
}

/**
 * How a trim drag is drawn: the edited clip's span, where its media is
 * anchored (the timeline time that would show `sourceIn`), and how far the
 * later clips on its track move. Mirrors the engine's `trim` / `trim_ripple`.
 * With ripple, the clip stays where it starts: trimming its start cuts (or
 * restores) its beginning and the rest of the track follows its end.
 */
export function trimPreview(
  clip: Clip,
  edge: 'start' | 'end',
  at: number,
  ripple: boolean,
): { start: number; end: number; origin: number; shift: number } {
  const end = clipEnd(clip);
  if (edge === 'end') {
    const newEnd = Math.max(at, clip.start);
    return { start: clip.start, end: newEnd, origin: clip.start, shift: ripple ? newEnd - end : 0 };
  }
  const cut = Math.min(at, end) - clip.start;
  return ripple
    ? { start: clip.start, end: end - cut, origin: clip.start - cut, shift: -cut }
    : { start: clip.start + cut, end, origin: clip.start, shift: 0 };
}
