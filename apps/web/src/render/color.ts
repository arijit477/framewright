import type { ColorAdjust } from '../engine/types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Luma weights of the CSS `saturate()` matrix (also used to keep white's brightness). */
const LUMA = [0.213, 0.715, 0.072] as const;

/**
 * Colour adjustments, as every rendering path applies them, in this order:
 *
 * 1. White balance (temperature and tint): per-channel gains, scaled so white
 *    keeps its brightness (`whiteBalanceGains`). CSS has no such filter, so
 *    Canvas 2D does this step in JavaScript (`whiteBalancePixels`).
 * 2. The clip's LUT, if any (render/lut.ts).
 * 3. Brightness, contrast and saturation, below.
 *
 * For step 3, the maths is exactly that of the CSS filter functions `brightness()`,
 * `contrast()` and `saturate()`, applied in that order to sRGB values with a
 * clamp after each step (Filter Effects spec). So:
 * - Canvas 2D uses `ctx.filter` with `cssFilter()` (fast, done by the browser),
 * - the WebGPU shader implements the same three steps on `colorParams()`,
 * - browsers without canvas filters fall back to `adjustPixels()`,
 * and all three match `adjustRgb()`, which the tests pin down.
 */
export interface ColorParams {
  /** Multiplies each channel (1 = unchanged). */
  brightness: number;
  /** Scales the distance from mid-grey (1 = unchanged, 0 = flat grey). */
  contrast: number;
  /** 0 = greyscale, 1 = unchanged, 2 = twice as saturated. */
  saturation: number;
}

export const NEUTRAL_COLOR: ColorAdjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

/** Whether brightness, contrast or saturation change anything (the CSS-filter part). */
export const hasToneAdjustment = (c: ColorAdjust | undefined): boolean =>
  !!c && (c.brightness !== 0 || c.contrast !== 0 || c.saturation !== 0);

/** Whether temperature or tint change anything. */
export const hasWhiteBalance = (c: ColorAdjust | undefined): boolean =>
  !!c && (c.temperature !== 0 || c.tint !== 0);

export const isNeutral = (c: ColorAdjust | undefined): boolean =>
  !hasToneAdjustment(c) && !hasWhiteBalance(c);

/** Whether two adjustments are the same (field by field, whatever the key order). */
export const sameColor = (a: ColorAdjust, b: ColorAdjust): boolean =>
  a.brightness === b.brightness &&
  a.contrast === b.contrast &&
  a.saturation === b.saturation &&
  a.temperature === b.temperature &&
  a.tint === b.tint;

/** Strongest gain change at ±100 (25%), before keeping white's brightness. */
const WHITE_BALANCE_RANGE = 0.25;

/**
 * Per-channel gains for temperature (red up and blue down when warmer) and
 * tint (green down when more magenta), divided by the luma of white so the
 * overall brightness stays the same.
 */
export function whiteBalanceGains(c: ColorAdjust): [number, number, number] {
  const warm = (c.temperature / 100) * WHITE_BALANCE_RANGE;
  const magenta = (c.tint / 100) * WHITE_BALANCE_RANGE;
  const gains = [1 + warm, 1 - magenta, 1 - warm] as const;
  // Relative to unchanged white (whose weighted sum isn't exactly 1 in floating point),
  // so neutral settings give gains of exactly 1.
  const luma = (r: number, g: number, b: number) => LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  const white = luma(...gains) / luma(1, 1, 1);
  return [gains[0] / white, gains[1] / white, gains[2] / white];
}

/** One pixel (channels 0..1) white-balanced: the reference for every path. */
export function whiteBalanceRgb(
  rgb: [number, number, number],
  gains: [number, number, number],
): [number, number, number] {
  return [clamp01(rgb[0] * gains[0]), clamp01(rgb[1] * gains[1]), clamp01(rgb[2] * gains[2])];
}

/** White-balance RGBA pixels in place (Canvas 2D). */
export function whiteBalancePixels(data: Uint8ClampedArray, gains: [number, number, number]): void {
  const [gr, gg, gb] = gains;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i]! * gr; // Uint8ClampedArray rounds and clamps
    data[i + 1] = data[i + 1]! * gg;
    data[i + 2] = data[i + 2]! * gb;
  }
}

/**
 * Stored values (-100..100) to filter amounts. Brightness is gentler (±50%)
 * so the slider's ends are still usable; -100 saturation is black and white.
 */
export function colorParams(c: ColorAdjust): ColorParams {
  return {
    brightness: 1 + c.brightness / 200,
    contrast: 1 + c.contrast / 100,
    saturation: 1 + c.saturation / 100,
  };
}

/** The equivalent CSS filter, for Canvas 2D's `ctx.filter`. */
export function cssFilter(c: ColorAdjust): string {
  if (!hasToneAdjustment(c)) return 'none';
  const p = colorParams(c);
  return `brightness(${p.brightness}) contrast(${p.contrast}) saturate(${p.saturation})`;
}

/**
 * One pixel (channels 0..1) through the adjustments: the reference for every
 * path. `saturate(s)` is written as a mix with the pixel's luma, L + s·(c − L),
 * which is the CSS matrix rearranged (and how the shader does it).
 */
export function adjustRgb(rgb: [number, number, number], p: ColorParams): [number, number, number] {
  const [r, g, b] = rgb.map((v) => {
    const bright = clamp01(v * p.brightness);
    return clamp01((bright - 0.5) * p.contrast + 0.5);
  }) as [number, number, number];
  const luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  const saturate = (v: number) => clamp01(luma + (v - luma) * p.saturation);
  return [saturate(r), saturate(g), saturate(b)];
}

/** Adjust RGBA pixels in place (Canvas 2D fallback where `ctx.filter` is unsupported). */
export function adjustPixels(data: Uint8ClampedArray, c: ColorAdjust): void {
  const p = colorParams(c);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = adjustRgb([data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255], p);
    data[i] = r * 255;
    data[i + 1] = g * 255;
    data[i + 2] = b * 255;
  }
}

const look = (patch: Partial<ColorAdjust>): ColorAdjust => ({ ...NEUTRAL_COLOR, ...patch });

/** Ready-made looks: each just sets the values, which stay editable. */
export const COLOR_PRESETS: { name: string; color: ColorAdjust }[] = [
  { name: 'Black & white', color: look({ contrast: 10, saturation: -100 }) },
  { name: 'Vivid', color: look({ contrast: 15, saturation: 40 }) },
  { name: 'Muted', color: look({ brightness: 5, contrast: -10, saturation: -40 }) },
  { name: 'Bright', color: look({ brightness: 20, contrast: 5, saturation: 10 }) },
  {
    name: 'Moody',
    color: look({ brightness: -15, contrast: 25, saturation: -20, temperature: -20 }),
  },
  { name: 'High contrast', color: look({ contrast: 45 }) },
  { name: 'Warm', color: look({ temperature: 35, saturation: 5 }) },
  { name: 'Cool', color: look({ temperature: -35, tint: -5 }) },
];
