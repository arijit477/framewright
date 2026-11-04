import { describe, expect, it } from 'vitest';
import {
  adjustPixels,
  adjustRgb,
  COLOR_PRESETS,
  colorParams,
  cssFilter,
  NEUTRAL_COLOR,
  sameColor,
  whiteBalanceGains,
  whiteBalancePixels,
  whiteBalanceRgb,
} from './color';

const adjust = (rgb: [number, number, number], brightness = 0, contrast = 0, saturation = 0) =>
  adjustRgb(rgb, colorParams({ ...NEUTRAL_COLOR, brightness, contrast, saturation })).map(
    (v) => Math.round(v * 1000) / 1000,
  );

describe('colour adjustments', () => {
  it('leaves pixels alone when neutral', () => {
    expect(adjust([0.2, 0.5, 0.9])).toEqual([0.2, 0.5, 0.9]);
    expect(cssFilter(NEUTRAL_COLOR)).toBe('none');
  });

  it('desaturates to luma (CSS weights) at -100', () => {
    expect(adjust([1, 0, 0], 0, 0, -100)).toEqual([0.213, 0.213, 0.213]);
    expect(adjust([0, 0, 1], 0, 0, -100)).toEqual([0.072, 0.072, 0.072]);
  });

  it('brightens by up to 50% and flattens to grey at -100 contrast', () => {
    expect(adjust([0.4, 0.4, 0.4], 100)).toEqual([0.6, 0.6, 0.6]);
    expect(adjust([0.4, 0.4, 0.4], -100)).toEqual([0.2, 0.2, 0.2]);
    expect(adjust([0.1, 0.9, 0.3], 0, -100)).toEqual([0.5, 0.5, 0.5]);
    expect(adjust([0.6, 0.6, 0.6], 0, 100)).toEqual([0.7, 0.7, 0.7]);
  });

  it('clamps after each step, like CSS filter chains', () => {
    // 0.8 brightened by 1.5 clips to 1, then halving contrast gives 0.75 (not 0.85).
    expect(adjust([0.8, 0.8, 0.8], 100, -50)).toEqual([0.75, 0.75, 0.75]);
    // Oversaturating stays in range.
    expect(adjust([1, 0.2, 0], 0, 0, 100).every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('describes the same maths as a CSS filter', () => {
    expect(cssFilter({ ...NEUTRAL_COLOR, brightness: 20, contrast: -30, saturation: -100 })).toBe(
      'brightness(1.1) contrast(0.7) saturate(0)',
    );
  });

  it('adjusts pixel buffers in place, keeping alpha', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 200]);
    adjustPixels(data, { ...NEUTRAL_COLOR, saturation: -100 });
    expect([...data]).toEqual([54, 54, 54, 200]);
  });

  it('only offers presets within range', () => {
    for (const { color } of COLOR_PRESETS) {
      for (const v of Object.values(color)) expect(Math.abs(v)).toBeLessThanOrEqual(100);
    }
  });
});

describe('white balance', () => {
  const gains = (temperature: number, tint: number) =>
    whiteBalanceGains({ ...NEUTRAL_COLOR, temperature, tint });
  const lumaOf = ([r, g, b]: [number, number, number]) => 0.213 * r + 0.715 * g + 0.072 * b;

  it('changes nothing at 0', () => {
    expect(gains(0, 0)).toEqual([1, 1, 1]);
  });

  it('warms by raising red and lowering blue, and tints by lowering green', () => {
    const [r, g, b] = gains(100, 0);
    expect(r).toBeGreaterThan(g);
    expect(b).toBeLessThan(g);
    const [, magentaGreen] = gains(0, 100);
    expect(magentaGreen).toBeLessThan(1);
    const [cr, , cb] = gains(-50, 0);
    expect(cb).toBeGreaterThan(cr);
  });

  it('keeps the brightness of white', () => {
    for (const [t, m] of [
      [100, 0],
      [-100, 0],
      [0, 100],
      [-60, 40],
    ] as const) {
      expect(lumaOf(gains(t, m))).toBeCloseTo(1, 10);
    }
  });

  it('clamps, and the pixel path matches the reference', () => {
    const g = gains(100, -100);
    expect(whiteBalanceRgb([1, 1, 1], g).every((v) => v <= 1)).toBe(true);
    const data = new Uint8ClampedArray([200, 100, 50, 255, 255, 255, 255, 7]);
    const expected = [
      ...whiteBalanceRgb([200 / 255, 100 / 255, 50 / 255], g),
      ...whiteBalanceRgb([1, 1, 1], g),
    ].map((v) => Math.round(v * 255));
    whiteBalancePixels(data, g);
    expect([data[0], data[1], data[2], data[4], data[5], data[6]]).toEqual(expected);
    expect([data[3], data[7]]).toEqual([255, 7]);
  });

  it('compares adjustments field by field', () => {
    const a = { ...NEUTRAL_COLOR, tint: 5 };
    const reordered = { tint: 5, temperature: 0, saturation: 0, contrast: 0, brightness: 0 };
    expect(sameColor(a, reordered)).toBe(true);
    expect(sameColor(a, NEUTRAL_COLOR)).toBe(false);
  });
});
