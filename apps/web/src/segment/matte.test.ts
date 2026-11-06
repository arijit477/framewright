import { describe, expect, it } from 'vitest';
import { EDGE, maskPixels, MATTE_INPUT, toMatteInput } from './matte';

describe('toMatteInput', () => {
  it('rescales to 0..1, channels first, without normalising', () => {
    const rgba = new Uint8ClampedArray(MATTE_INPUT * MATTE_INPUT * 4);
    rgba.set([255, 51, 0, 255], 0);
    const data = toMatteInput(rgba);
    const plane = MATTE_INPUT * MATTE_INPUT;
    expect(data[0]).toBe(1);
    expect(data[plane]).toBeCloseTo(0.2, 6);
    expect(data[2 * plane]).toBe(0);
  });
});

describe('maskPixels', () => {
  const alphaOf = (a: number) => maskPixels(Float32Array.from([a]))[3]!;

  it('is opaque white where the person is, transparent where the background is', () => {
    expect([...maskPixels(Float32Array.from([1]))]).toEqual([255, 255, 255, 255]);
    expect(alphaOf(0)).toBe(0);
  });

  it('drops the faint halo the model leaves around people', () => {
    expect(alphaOf(EDGE.low)).toBe(0);
    expect(alphaOf(0.2)).toBe(0);
    expect(alphaOf(EDGE.high)).toBe(255);
  });

  it('keeps a soft edge in between, rising smoothly', () => {
    const values = [0.35, 0.45, 0.5, 0.55, 0.65].map(alphaOf);
    expect(alphaOf(0.5)).toBe(128);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
  });
});
