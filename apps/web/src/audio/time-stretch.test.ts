import { describe, expect, it } from 'vitest';
import { TimeStretcher } from './time-stretch';

const RATE = 48_000;

const sine = (hz: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from(
    { length: Math.round(RATE * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE),
  );

/** Push `input` in decoder-sized chunks and collect all output. */
function stretch(input: Float32Array, speed: number): Float32Array {
  const stretcher = new TimeStretcher(speed, RATE);
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1024) {
    const chunk = input.subarray(i, i + 1024);
    stretcher.push(chunk, chunk);
    const n = stretcher.available;
    const left = new Float32Array(n);
    stretcher.mixInto(left, new Float32Array(n), 0, n, 1);
    out.push(...left);
  }
  return Float32Array.from(out);
}

/** Frequency from upward zero crossings over the middle of the signal (skipping the edges). */
function frequency(signal: Float32Array): number {
  const from = Math.floor(signal.length * 0.2);
  const to = Math.floor(signal.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (signal[i - 1]! < 0 && signal[i]! >= 0) crossings++;
  return crossings / ((to - from) / RATE);
}

const rms = (signal: Float32Array) => {
  const middle = signal.subarray(signal.length * 0.2, signal.length * 0.8);
  return Math.sqrt(middle.reduce((sum, v) => sum + v * v, 0) / middle.length);
};

describe('TimeStretcher', () => {
  for (const speed of [0.25, 0.5, 1.5, 2, 4]) {
    it(`changes the length but keeps the pitch and level at ${speed}x`, () => {
      const input = sine(440, 4);
      const output = stretch(input, speed);
      // Length: input / speed, short by at most the input still in flight at
      // the end (one window plus the search range, ~52 ms of input).
      const expected = input.length / speed;
      expect(output.length).toBeLessThanOrEqual(expected + RATE * 0.02);
      expect(output.length).toBeGreaterThan(expected - (RATE * 0.06) / speed);
      expect(frequency(output)).toBeGreaterThan(435);
      expect(frequency(output)).toBeLessThan(445);
      expect(rms(output)).toBeCloseTo(rms(input), 1);
    });
  }

  it('starts at full level, with no fade-in', () => {
    const input = new Float32Array(RATE).fill(0.5);
    const output = stretch(input, 2);
    expect(output[0]).toBe(0.5);
    expect(Math.min(...output.subarray(0, 4000))).toBeCloseTo(0.5, 5);
  });

  it('pads with silence when asked for more than it has, and applies gain', () => {
    const stretcher = new TimeStretcher(2, RATE);
    const input = new Float32Array(RATE / 10).fill(1);
    stretcher.push(input, input);
    const ready = stretcher.available;
    const left = new Float32Array(ready + 100);
    stretcher.mixInto(left, new Float32Array(ready + 100), 0, ready + 100, 0.5);
    expect(left[0]).toBe(0.5);
    expect(left[ready + 50]).toBe(0);
    expect(stretcher.available).toBe(0);
  });
});
