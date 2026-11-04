import type { ColorAdjust } from '../engine/types';

/**
 * Colour adjustments, as every rendering path applies them.
 *
 * The maths is exactly that of the CSS filter functions `brightness()`,
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

export const NEUTRAL_COLOR: ColorAdjust = { brightness: 0, contrast: 0, saturation: 0 };

export const isNeutral = (c: ColorAdjust | undefined): boolean =>
  !c || (c.brightness === 0 && c.contrast === 0 && c.saturation === 0);

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
  if (isNeutral(c)) return 'none';
  const p = colorParams(c);
  return `brightness(${p.brightness}) contrast(${p.contrast}) saturate(${p.saturation})`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Luma weights of the CSS `saturate()` matrix. */
const LUMA = [0.213, 0.715, 0.072] as const;

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

/** Ready-made looks: each just sets the three values, which stay editable. */
export const COLOR_PRESETS: { name: string; color: ColorAdjust }[] = [
  { name: 'Black & white', color: { brightness: 0, contrast: 10, saturation: -100 } },
  { name: 'Vivid', color: { brightness: 0, contrast: 15, saturation: 40 } },
  { name: 'Muted', color: { brightness: 5, contrast: -10, saturation: -40 } },
  { name: 'Bright', color: { brightness: 20, contrast: 5, saturation: 10 } },
  { name: 'Moody', color: { brightness: -15, contrast: 25, saturation: -20 } },
  { name: 'High contrast', color: { brightness: 0, contrast: 45, saturation: 0 } },
];
