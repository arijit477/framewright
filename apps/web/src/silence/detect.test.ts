import { describe, expect, it } from 'vitest';
import { DEFAULT_SILENCE, loudness, silentRanges, WINDOW_US } from './detect';

const RATE = 16_000;
const WINDOW = (RATE * WINDOW_US) / 1e6;

/** Sound made of [seconds, amplitude] parts (a 400 Hz tone, whole cycles per window, or silence at 0). */
function sound(...parts: [number, number][]): Float32Array {
  const out = new Float32Array(Math.round(parts.reduce((s, [d]) => s + d, 0) * RATE));
  let at = 0;
  for (const [seconds, amplitude] of parts) {
    const n = Math.round(seconds * RATE);
    for (let i = 0; i < n; i++) out[at + i] = amplitude * Math.sin((2 * Math.PI * 400 * i) / RATE);
    at += n;
  }
  return out;
}
const ranges = (samples: Float32Array, options = DEFAULT_SILENCE) =>
  silentRanges(loudness(samples, WINDOW), (samples.length / RATE) * 1e6, options).map(([a, b]) => [
    a / 1e6,
    b / 1e6,
  ]);

describe('loudness', () => {
  it('measures RMS in dBFS per window', () => {
    const db = loudness(sound([0.1, 1]), WINDOW);
    expect(db).toHaveLength(10);
    expect(db[0]).toBeCloseTo(-3.01, 1); // a full-scale sine: RMS 1/√2
    expect(loudness(new Float32Array(WINDOW), WINDOW)[0]).toBe(-Infinity);
  });
});

describe('silentRanges', () => {
  it('cuts a long pause, keeping a margin around the speech', () => {
    // speech 1 s, pause 1 s, speech 1 s
    expect(ranges(sound([1, 0.3], [1, 0], [1, 0.3]))).toEqual([[1.15, 1.85]]);
  });

  it('keeps pauses shorter than the minimum', () => {
    expect(ranges(sound([1, 0.3], [0.4, 0], [1, 0.3]))).toEqual([]);
    expect(
      ranges(sound([1, 0.3], [0.4, 0], [1, 0.3]), { ...DEFAULT_SILENCE, minSilenceUs: 300_000 }),
    ).toEqual([[1.15, 1.25]]);
  });

  it('cuts silence at the very start and end right to the edge', () => {
    expect(ranges(sound([0.8, 0], [1, 0.3], [0.6, 0]))).toEqual([
      [0, 0.65],
      [1.95, 2.4],
    ]);
  });

  it('treats quiet sound below the threshold as silence, and louder sound as not', () => {
    const quiet = sound([1, 0.3], [1, 0.005], [1, 0.3]); // about -49 dB in the pause
    expect(ranges(quiet)).toEqual([[1.15, 1.85]]);
    expect(ranges(quiet, { ...DEFAULT_SILENCE, thresholdDb: -60 })).toEqual([]);
  });

  it('finds nothing in continuous sound, and all of a silent clip', () => {
    expect(ranges(sound([2, 0.3]))).toEqual([]);
    expect(ranges(sound([2, 0]))).toEqual([[0, 2]]);
  });
});
