/**
 * 3D colour look-up tables (LUTs).
 *
 * A LUT is an N×N×N grid of output colours: the input colour picks a point
 * inside the grid and the output is blended from the 8 surrounding entries
 * (trilinear interpolation). That's what the GPU's 3D-texture filtering does,
 * so the WebGPU shader, the Canvas 2D pixel path (`lutPixels`) and the
 * reference (`applyLutRgb`) all agree.
 *
 * LUTs come from `.cube` files (the Adobe / DaVinci Resolve format) and are
 * stored with the project at 16-bit precision.
 */

export interface Lut {
  /** Entries per side (N). */
  size: number;
  /** N³ RGB triples, 0..1, red changing fastest, then green, then blue. */
  data: Float32Array;
}

export const MIN_LUT_SIZE = 2;
export const MAX_LUT_SIZE = 65;

export class CubeError extends Error {
  override name = 'CubeError';
}

/**
 * Parse a `.cube` file. Supports 3D LUTs with the default 0–1 input range;
 * output values are clamped to 0–1 (the picture is display-referred).
 */
export function parseCube(text: string): { title: string | null; lut: Lut } {
  let title: string | null = null;
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    switch (keyword) {
      case 'TITLE':
        title = line.slice('TITLE'.length).trim().replace(/^"|"$/g, '') || null;
        continue;
      case 'LUT_3D_SIZE':
        size = Number(rest[0]);
        if (!Number.isInteger(size) || size < MIN_LUT_SIZE || size > MAX_LUT_SIZE) {
          throw new CubeError(
            `LUT size ${rest[0]} isn't supported (${MIN_LUT_SIZE} to ${MAX_LUT_SIZE}).`,
          );
        }
        continue;
      case 'LUT_1D_SIZE':
        throw new CubeError('This is a 1D LUT; only 3D LUTs are supported.');
      case 'DOMAIN_MIN':
      case 'DOMAIN_MAX':
      case 'LUT_3D_INPUT_RANGE': {
        const expected = keyword === 'DOMAIN_MAX' ? 1 : keyword === 'DOMAIN_MIN' ? 0 : null;
        const range = rest.map(Number);
        const ok =
          expected === null
            ? range[0] === 0 && range[1] === 1
            : range.length === 3 && range.every((v) => v === expected);
        if (!ok) throw new CubeError('LUTs with a custom input range aren’t supported yet.');
        continue;
      }
    }
    // A data line: three numbers.
    const numbers = line.split(/\s+/).map(Number);
    if (numbers.length !== 3 || numbers.some((v) => !Number.isFinite(v))) {
      throw new CubeError(`Unexpected line in the LUT: “${line.slice(0, 40)}”.`);
    }
    for (const v of numbers) values.push(Math.min(1, Math.max(0, v)));
  }
  if (size === 0) throw new CubeError('Not a 3D LUT: LUT_3D_SIZE is missing.');
  if (values.length !== size ** 3 * 3) {
    throw new CubeError(
      `The LUT should have ${size ** 3} entries but has ${Math.floor(values.length / 3)}.`,
    );
  }
  return { title, lut: { size, data: Float32Array.from(values) } };
}

/** A LUT that changes nothing (`f(c) = c`), or any per-entry function of the grid colour. */
export function makeLut(
  size: number,
  f: (r: number, g: number, b: number) => [number, number, number] = (r, g, b) => [r, g, b],
): Lut {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = f(r / (size - 1), g / (size - 1), b / (size - 1));
        data[i++] = out[0];
        data[i++] = out[1];
        data[i++] = out[2];
      }
  return { size, data };
}

/**
 * One colour (channels 0..1) through the LUT, blended with the original by
 * `intensity` (0..1): the reference every rendering path matches.
 */
export function applyLutRgb(
  rgb: [number, number, number],
  lut: Lut,
  intensity: number,
): [number, number, number] {
  const { size: n, data } = lut;
  const axis = (v: number) => {
    const p = Math.min(1, Math.max(0, v)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(p));
    return [i, p - i] as const;
  };
  const [r0, fr] = axis(rgb[0]);
  const [g0, fg] = axis(rgb[1]);
  const [b0, fb] = axis(rgb[2]);
  const out: [number, number, number] = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const dr = corner & 1;
    const dg = (corner >> 1) & 1;
    const db = (corner >> 2) & 1;
    const weight = (dr ? fr : 1 - fr) * (dg ? fg : 1 - fg) * (db ? fb : 1 - fb);
    const index = (((b0 + db) * n + (g0 + dg)) * n + (r0 + dr)) * 3;
    out[0] += data[index]! * weight;
    out[1] += data[index + 1]! * weight;
    out[2] += data[index + 2]! * weight;
  }
  return [0, 1, 2].map((c) => rgb[c]! + (out[c]! - rgb[c]!) * intensity) as [
    number,
    number,
    number,
  ];
}

/**
 * Apply a LUT to RGBA pixels in place (Canvas 2D path): the same trilinear
 * maths as `applyLutRgb`, with the per-channel grid positions precomputed for
 * all 256 byte values, so a 1080p frame takes tens of milliseconds.
 */
export function lutPixels(pixels: Uint8ClampedArray, lut: Lut, intensity: number): void {
  const { size: n, data } = lut;
  const base = new Int32Array(256);
  const frac = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const p = (v / 255) * (n - 1);
    const i = Math.min(n - 2, Math.floor(p));
    base[v] = i;
    frac[v] = p - i;
  }
  const strideG = n * 3;
  const strideB = n * n * 3;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const fr = frac[r]!;
    const fg = frac[g]!;
    const fb = frac[b]!;
    const o = base[b]! * strideB + base[g]! * strideG + base[r]! * 3;
    for (let c = 0; c < 3; c++) {
      const p000 = data[o + c]!;
      const p100 = data[o + 3 + c]!;
      const p010 = data[o + strideG + c]!;
      const p110 = data[o + strideG + 3 + c]!;
      const p001 = data[o + strideB + c]!;
      const p101 = data[o + strideB + 3 + c]!;
      const p011 = data[o + strideB + strideG + c]!;
      const p111 = data[o + strideB + strideG + 3 + c]!;
      const x00 = p000 + (p100 - p000) * fr;
      const x10 = p010 + (p110 - p010) * fr;
      const x01 = p001 + (p101 - p001) * fr;
      const x11 = p011 + (p111 - p011) * fr;
      const y0 = x00 + (x10 - x00) * fg;
      const y1 = x01 + (x11 - x01) * fg;
      const value = (y0 + (y1 - y0) * fb) * 255;
      const original = pixels[i + c]!;
      pixels[i + c] = original + (value - original) * intensity;
    }
  }
}

/** Store a LUT compactly: its entries as 16-bit integers, little-endian, base64. */
export function encodeLut(lut: Lut): string {
  const words = new Uint16Array(lut.data.length);
  for (let i = 0; i < words.length; i++) words[i] = Math.round(lut.data[i]! * 65535);
  const bytes = new Uint8Array(words.buffer);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    for (let i = 0; i < bytes.length; i += 2) [bytes[i], bytes[i + 1]] = [bytes[i + 1]!, bytes[i]!];
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The inverse of `encodeLut`; throws if the data doesn't fit the size. */
export function decodeLut(size: number, encoded: string): Lut {
  const binary = atob(encoded);
  if (binary.length !== size ** 3 * 3 * 2) throw new CubeError('Stored LUT data is damaged.');
  const data = new Float32Array(size ** 3 * 3);
  for (let i = 0; i < data.length; i++) {
    const word = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    data[i] = word / 65535;
  }
  return { size, data };
}

/** A 0..1 float as an IEEE half-float bit pattern (round to nearest). */
export function toHalf(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  if (v === 0) return 0;
  const floats = new Float32Array([v]);
  const bits = new Uint32Array(floats.buffer)[0]!;
  const exponent = ((bits >> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    // Subnormal half: shift the mantissa (with its implicit 1) into place.
    return Math.round((mantissa | 0x800000) / 2 ** (14 - exponent)) >> 0;
  }
  // Round the 23-bit mantissa to 10 bits (a carry into the exponent is correct).
  return ((exponent << 10) + Math.round(mantissa / 8192)) & 0xffff;
}
