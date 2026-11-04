import { describe, expect, it } from 'vitest';
import { blockBoundaries, isSilent, SILENCE_PEAK } from './blocks';

const RATE = 1000; // 1 sample = 1 ms, to keep numbers readable

describe('blockBoundaries', () => {
  it('keeps short audio in one block', () => {
    expect(blockBoundaries(new Float32Array(30 * RATE), RATE, 120, 5)).toEqual([0, 30 * RATE]);
  });

  it('cuts long audio near each block length, in the quietest spot', () => {
    // 300 s of "speech" (constant level) with a silent gap at 118-119 s.
    const samples = new Float32Array(300 * RATE).fill(0.5);
    samples.fill(0, 118 * RATE, 119 * RATE);
    const cuts = blockBoundaries(samples, RATE, 120, 5);
    expect(cuts[0]).toBe(0);
    expect(cuts[1]).toBeGreaterThanOrEqual(118 * RATE);
    expect(cuts[1]).toBeLessThan(119 * RATE);
    expect(cuts.at(-1)).toBe(300 * RATE);
    // Every block is about two minutes, give or take the search window.
    for (let i = 1; i < cuts.length - 1; i++) {
      expect(cuts[i]! - cuts[i - 1]!).toBeGreaterThan(110 * RATE);
      expect(cuts[i]! - cuts[i - 1]!).toBeLessThan(130 * RATE);
    }
  });
});

describe('isSilent', () => {
  it('is true only when nothing rises above the noise floor', () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
    expect(isSilent(new Float32Array(1000).fill(SILENCE_PEAK / 2))).toBe(true);
    const speech = new Float32Array(1000);
    speech[500] = -0.2;
    expect(isSilent(speech)).toBe(false);
  });
});
