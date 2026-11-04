import { describe, expect, it } from 'vitest';
import type { TimelineSnapshot } from '../engine/types';
import { secondsToMicros } from '../lib/time';
import {
  clipsInRect,
  dropTarget,
  rectBetween,
  hitTest,
  maxScrollY,
  peakToHeight,
  snap,
  timeToX,
  trackRows,
  transitionWindow,
  trackTop,
  trimPreview,
  TRACK_HEIGHT,
  xToTime,
  type View,
} from './geometry';

const view: View = { pxPerSecond: 100, scrollUs: 0, scrollY: 0 };

const timeline: TimelineSnapshot = {
  tracks: [
    {
      id: 1,
      kind: 'video',
      clips: [
        {
          id: 2,
          assetId: 'a',
          start: secondsToMicros(1),
          duration: secondsToMicros(2),
          sourceIn: 0,
          sourceDuration: secondsToMicros(5),
          volumePercent: 100,
          muted: false,
        },
      ],
    },
  ],
};

const midTrack = trackTop(0) + TRACK_HEIGHT / 2;

describe('time <-> x', () => {
  it('round-trips', () => {
    const scrolled = { ...view, scrollUs: secondsToMicros(3) };
    expect(xToTime(timeToX(secondsToMicros(7), scrolled), scrolled)).toBeCloseTo(
      secondsToMicros(7),
    );
  });
});

describe('hitTest', () => {
  const x = (s: number) => timeToX(secondsToMicros(s), view);

  it('finds the ruler', () => {
    expect(hitTest(timeline, view, 50, 5)).toEqual({ kind: 'ruler' });
  });

  it('finds clip edges and body', () => {
    expect(hitTest(timeline, view, x(1), midTrack)).toMatchObject({ kind: 'clip', edge: 'start' });
    expect(hitTest(timeline, view, x(3), midTrack)).toMatchObject({ kind: 'clip', edge: 'end' });
    expect(hitTest(timeline, view, x(2), midTrack)).toMatchObject({ kind: 'clip', edge: null });
  });

  it('finds empty track space', () => {
    expect(hitTest(timeline, view, x(4), midTrack)).toEqual({ kind: 'track', trackId: 1 });
  });
});

describe('snap', () => {
  it('snaps within the threshold only', () => {
    const target = secondsToMicros(2);
    expect(snap(target + secondsToMicros(0.05), [target], view)).toBe(target);
    expect(snap(target + secondsToMicros(0.5), [target], view)).toBe(target + secondsToMicros(0.5));
  });
});

describe('peakToHeight', () => {
  it('maps full scale to 1 and the floor to 0 on a dB scale', () => {
    expect(peakToHeight(1)).toBe(1);
    expect(peakToHeight(0)).toBe(0);
    expect(peakToHeight(10 ** (-48 / 20))).toBeCloseTo(0);
    expect(peakToHeight(10 ** (-24 / 20))).toBeCloseTo(0.5); // -24 dB is half height
  });

  it('clamps boosted peaks', () => {
    expect(peakToHeight(2)).toBe(1);
  });
});

describe('multiple tracks', () => {
  const track = (id: number, kind: 'video' | 'audio', clipStart?: number) => ({
    id,
    kind,
    clips:
      clipStart === undefined
        ? []
        : [
            {
              id: id * 10,
              assetId: 'x',
              start: secondsToMicros(clipStart),
              duration: secondsToMicros(1),
              sourceIn: 0,
              sourceDuration: secondsToMicros(1),
              volumePercent: 100,
              muted: false,
            },
          ],
  });
  // Engine order: V1, A1, V2. V2 composites on top, so it's displayed first.
  const multi: TimelineSnapshot = {
    tracks: [track(1, 'video', 0), track(2, 'audio'), track(3, 'video', 2)],
  };
  const centre = (row: number, scrollY = 0) => trackTop(row, scrollY) + TRACK_HEIGHT / 2;

  it('shows the top video layer first, then audio', () => {
    expect(trackRows(multi).map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it('hit-tests rows in display order, including when scrolled', () => {
    const x = timeToX(secondsToMicros(2.5), view);
    expect(hitTest(multi, view, x, centre(0))).toMatchObject({ kind: 'clip', trackId: 3 });
    const scrolled = { ...view, scrollY: TRACK_HEIGHT + 6 };
    // Scrolled by one row: the second row (V1) now sits where the first was.
    expect(hitTest(multi, scrolled, timeToX(secondsToMicros(0.5), view), centre(0))).toMatchObject({
      kind: 'clip',
      trackId: 1,
    });
  });

  it('drops onto tracks of the same kind, or creates a new one at the edges', () => {
    expect(dropTarget(multi, view, centre(1), 'video')).toEqual({ type: 'track', trackId: 1 });
    expect(dropTarget(multi, view, 5, 'video')).toEqual({ type: 'new', kind: 'video' }); // above the top row
    expect(dropTarget(multi, view, centre(2), 'audio')).toEqual({ type: 'track', trackId: 2 });
    expect(dropTarget(multi, view, centre(2) + 60, 'audio')).toEqual({
      type: 'new',
      kind: 'audio',
    });
  });

  it('keeps clips on their own kind of track', () => {
    // A video clip dragged over the audio row lands on the nearest video track.
    expect(dropTarget(multi, view, centre(2), 'video')).toEqual({ type: 'track', trackId: 1 });
    // An audio clip dragged over video rows lands on the audio track.
    expect(dropTarget(multi, view, centre(0), 'audio')).toEqual({ type: 'track', trackId: 2 });
  });

  it('limits vertical scrolling to the content', () => {
    expect(maxScrollY(3, 1000)).toBe(0);
    expect(maxScrollY(10, 300)).toBe(trackTop(10) + 6 - 300);
  });
});

describe('transitionWindow', () => {
  const clip = (id: number, start: number, seconds: number, patch: object = {}) => ({
    id,
    assetId: 'a',
    start: secondsToMicros(start),
    duration: secondsToMicros(seconds),
    sourceIn: 0,
    sourceDuration: secondsToMicros(60),
    volumePercent: 100,
    muted: false,
    ...patch,
  });
  const fade = { transitionIn: { kind: 'crossfade' as const, durationMs: 1000 } };

  it('is centred on the cut', () => {
    expect(transitionWindow(clip(1, 0, 6), clip(2, 6, 3, fade))).toEqual([
      secondsToMicros(5.5),
      secondsToMicros(6.5),
    ]);
  });

  it('is clamped to the shorter clip', () => {
    expect(transitionWindow(clip(1, 0, 6), clip(2, 6, 0.4, fade))).toEqual([
      secondsToMicros(5.8),
      secondsToMicros(6.2),
    ]);
  });

  it('is inactive when the clips do not touch, or for titles', () => {
    expect(transitionWindow(clip(1, 0, 5), clip(2, 6, 3, fade))).toBeNull();
    expect(transitionWindow(undefined, clip(2, 6, 3, fade))).toBeNull();
    const title = { text: { text: 'Hi', style: {} as never } };
    expect(transitionWindow(clip(1, 0, 6, title), clip(2, 6, 3, fade))).toBeNull();
  });
});

describe('trimPreview', () => {
  const S = 1_000_000;
  // 2-6 s on the timeline.
  const clip = timeline.tracks[0]!.clips[0]!;
  const at2to6 = { ...clip, start: 2 * S, duration: 4 * S };

  it('moves the dragged edge without ripple', () => {
    expect(trimPreview(at2to6, 'start', 3 * S, false)).toEqual({
      start: 3 * S,
      end: 6 * S,
      origin: 2 * S,
      shift: 0,
    });
    expect(trimPreview(at2to6, 'end', 5 * S, false).end).toBe(5 * S);
  });

  it('keeps the clip in place with ripple, and moves later clips by the change', () => {
    // Cutting 1 s off the start: the clip still starts at 2 s, its media one second later.
    expect(trimPreview(at2to6, 'start', 3 * S, true)).toEqual({
      start: 2 * S,
      end: 5 * S,
      origin: S,
      shift: -S,
    });
    expect(trimPreview(at2to6, 'start', S, true).shift).toBe(S); // restoring pushes out
    expect(trimPreview(at2to6, 'end', 8 * S, true)).toMatchObject({ end: 8 * S, shift: 2 * S });
  });

  it('never draws a negative length', () => {
    expect(trimPreview(at2to6, 'end', 0, true)).toMatchObject({ end: 2 * S, shift: -4 * S });
    expect(trimPreview(at2to6, 'start', 9 * S, false).start).toBe(6 * S);
  });
});

describe('selection box', () => {
  const S = 1_000_000;
  const clip = (id: number, start: number, seconds: number) => ({
    ...timeline.tracks[0]!.clips[0]!,
    id,
    start: start * S,
    duration: seconds * S,
  });
  // Display rows: V2 (clip 3 at 4-6 s), V1 (clips 1 at 0-2 s, 2 at 3-4 s), A1 (clip 4 at 1-5 s).
  const multi: TimelineSnapshot = {
    tracks: [
      { id: 10, kind: 'video', clips: [clip(1, 0, 2), clip(2, 3, 1)] },
      { id: 11, kind: 'audio', clips: [clip(4, 1, 4)] },
      { id: 12, kind: 'video', clips: [clip(3, 4, 2)] },
    ],
  };
  const x = (s: number) => timeToX(s * S, view);
  const rowMiddle = (row: number) => trackTop(row) + TRACK_HEIGHT / 2;

  it('normalises corners dragged in any direction', () => {
    expect(rectBetween(10, 50, 2, 20)).toEqual({ left: 2, top: 20, right: 10, bottom: 50 });
  });

  it('selects clips the box touches, across rows', () => {
    // From 1.5 s on the top row down to 3.5 s on the middle row.
    const box = rectBetween(x(1.5), rowMiddle(0), x(3.5), rowMiddle(1));
    expect(clipsInRect(multi, view, box)).toEqual([1, 2]);
    // Down into the audio row as well picks up its clip; the top row's clip (4-6 s) isn't reached.
    expect(
      clipsInRect(multi, view, rectBetween(x(1.5), rowMiddle(0), x(3.5), rowMiddle(2))),
    ).toEqual([1, 2, 4]);
  });

  it('selects nothing in empty space', () => {
    expect(clipsInRect(multi, view, rectBetween(x(7), rowMiddle(0), x(9), rowMiddle(2)))).toEqual(
      [],
    );
    // Within a row's time range but in the gap between rows.
    const gapTop = trackTop(1) - 5;
    expect(clipsInRect(multi, view, rectBetween(x(0), gapTop, x(1), gapTop + 2))).toEqual([]);
  });
});
