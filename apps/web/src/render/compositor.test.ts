import { describe, expect, it } from 'vitest';
import { adjustRgb, colorParams, NEUTRAL_COLOR, whiteBalanceGains, whiteBalanceRgb } from './color';
import { applyLutRgb, makeLut } from './lut';
import { selfTestExpected } from './compositor';

/**
 * The WebGPU self-test reads back one grey value. It's only a real check if
 * the pipeline in any other order (or with a step missing) would read back
 * something else by more than its tolerance (6 of 255).
 */
describe('WebGPU self-test expectation', () => {
  const color = { ...NEUTRAL_COLOR, temperature: -100, saturation: -100 };
  const invert = makeLut(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);
  const desaturate = (rgb: [number, number, number]) => adjustRgb(rgb, colorParams(color));
  const balance = (rgb: [number, number, number]) => whiteBalanceRgb(rgb, whiteBalanceGains(color));
  const lut = (rgb: [number, number, number]) => applyLutRgb(rgb, invert, 1);
  const tolerance = 6 / 255;

  it('is the grey of cooled red, inverted, then desaturated', () => {
    expect(selfTestExpected()).toBeCloseTo(0.834, 3);
  });

  it('would catch a wrong order or a missing step', () => {
    const wrong = [
      desaturate(lut([1, 0, 0])), // no white balance
      desaturate(balance(lut([1, 0, 0]))), // white balance after the LUT
      balance(desaturate(lut([1, 0, 0]))), // white balance last (not even grey)
      desaturate(balance([1, 0, 0])), // no LUT
    ];
    for (const rgb of wrong) {
      const off = Math.max(...rgb.map((v) => Math.abs(v - selfTestExpected())));
      expect(off).toBeGreaterThan(tolerance);
    }
  });
});
