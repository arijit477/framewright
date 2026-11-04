import { describe, expect, it } from 'vitest';
import type { Clip, TimelineSnapshot } from '../engine/types';
import { cleanLutName, lutUsage, MAX_LUT_NAME_LENGTH } from './luts';

const clip = (id: number, lutId?: string): Clip => ({
  id,
  assetId: 'a',
  start: id * 1_000_000,
  duration: 1_000_000,
  sourceIn: 0,
  sourceDuration: 10_000_000,
  volumePercent: 100,
  muted: false,
  ...(lutId ? { lut: { lutId, intensityPercent: 100 } } : {}),
});

describe('lutUsage', () => {
  it('counts clips per LUT across tracks', () => {
    const timeline: TimelineSnapshot = {
      tracks: [
        { id: 1, kind: 'video', clips: [clip(1, 'warm'), clip(2), clip(3, 'cool')] },
        { id: 2, kind: 'video', clips: [clip(4, 'warm')] },
      ],
    };
    expect([...lutUsage(timeline)]).toEqual([
      ['warm', 2],
      ['cool', 1],
    ]);
    expect(lutUsage({ tracks: [] }).size).toBe(0);
  });
});

describe('cleanLutName', () => {
  it('tidies names and refuses empty ones', () => {
    expect(cleanLutName('  Teal   &  Orange ')).toBe('Teal & Orange');
    expect(cleanLutName('   ')).toBeNull();
    expect(cleanLutName('x'.repeat(200))).toHaveLength(MAX_LUT_NAME_LENGTH);
  });
});
