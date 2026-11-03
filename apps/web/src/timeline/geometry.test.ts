import { describe, expect, it } from 'vitest';
import type { TimelineSnapshot } from '../engine/types';
import { secondsToMicros } from '../lib/time';
import {
  hitTest,
  peakToHeight,
  snap,
  timeToX,
  trackTop,
  TRACK_HEIGHT,
  xToTime,
  type View,
} from './geometry';

const view: View = { pxPerSecond: 100, scrollUs: 0 };

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
