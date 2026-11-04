import { describe, expect, it } from 'vitest';
import {
  adjustPixels,
  adjustRgb,
  COLOR_PRESETS,
  colorParams,
  cssFilter,
  NEUTRAL_COLOR,
} from './color';

const adjust = (rgb: [number, number, number], brightness = 0, contrast = 0, saturation = 0) =>
  adjustRgb(rgb, colorParams({ brightness, contrast, saturation })).map(
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
    expect(cssFilter({ brightness: 20, contrast: -30, saturation: -100 })).toBe(
      'brightness(1.1) contrast(0.7) saturate(0)',
    );
  });

  it('adjusts pixel buffers in place, keeping alpha', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 200]);
    adjustPixels(data, { brightness: 0, contrast: 0, saturation: -100 });
    expect([...data]).toEqual([54, 54, 54, 200]);
  });

  it('only offers presets within range', () => {
    for (const { color } of COLOR_PRESETS) {
      for (const v of Object.values(color)) expect(Math.abs(v)).toBeLessThanOrEqual(100);
    }
  });
});
