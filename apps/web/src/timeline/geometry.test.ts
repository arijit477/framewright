import { describe, expect, it } from 'vitest';
import type { TimelineSnapshot } from '../engine/types';
import { secondsToMicros } from '../lib/time';
import {
  dropTarget,
  hitTest,
  maxScrollY,
  peakToHeight,
  snap,
  timeToX,
  trackRows,
  trackTop,
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
