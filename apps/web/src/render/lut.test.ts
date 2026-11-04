import { describe, expect, it } from 'vitest';
import {
  applyLutRgb,
  CubeError,
  decodeLut,
  encodeLut,
  lutPixels,
  makeLut,
  parseCube,
  toHalf,
} from './lut';

const cube = (size: number, rows: string[], header = '') =>
  `${header}TITLE "Test"\nLUT_3D_SIZE ${size}\n${rows.join('\n')}\n`;

/** The 2×2×2 inverting LUT as .cube rows (red fastest). */
const INVERT_ROWS = Array.from({ length: 8 }, (_, i) => {
  const [r, g, b] = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
  return `${1 - r} ${1 - g} ${1 - b}`;
});

describe('parseCube', () => {
  it('reads the title, size and entries (red fastest)', () => {
    const { title, lut } = parseCube(cube(2, INVERT_ROWS, '# comment\n\n'));
    expect(title).toBe('Test');
    expect(lut.size).toBe(2);
    expect([...lut.data.slice(0, 6)]).toEqual([1, 1, 1, 0, 1, 1]);
  });

  it('accepts the default input range and clamps outputs', () => {
    const rows = [...INVERT_ROWS];
    rows[0] = '1.5 -0.2 0.5';
    const { lut } = parseCube(cube(2, rows, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n'));
    expect([...lut.data.slice(0, 3)]).toEqual([1, 0, 0.5]);
  });

  it('explains what it cannot read', () => {
    const fails = (text: string) => expect(() => parseCube(text)).toThrow(CubeError);
    fails('LUT_1D_SIZE 1024\n0 0 0');
    fails(cube(2, INVERT_ROWS.slice(1))); // an entry missing
    fails(cube(2, [...INVERT_ROWS.slice(1), '0 0 x']));
    fails(cube(66, []));
    fails(cube(2, INVERT_ROWS, 'DOMAIN_MAX 2 2 2\n'));
    fails('0 0 0\n1 1 1'); // no size
    expect(() => parseCube('LUT_1D_SIZE 4')).toThrow(/1D LUT/);
  });
});

describe('applying a LUT', () => {
  const invert = makeLut(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);

  it('leaves colours alone with an identity LUT or zero intensity', () => {
    const identity = makeLut(17);
    const out = applyLutRgb([0.2, 0.55, 0.9], identity, 1);
    out.forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.55, 0.9][i]!, 6));
    expect(applyLutRgb([0.2, 0.55, 0.9], invert, 0)).toEqual([0.2, 0.55, 0.9]);
  });

  it('interpolates between entries and blends by intensity', () => {
    expect(applyLutRgb([1, 0, 0], invert, 1)).toEqual([0, 1, 1]);
    const mid = applyLutRgb([0.25, 0.5, 0.75], invert, 1);
    mid.forEach((v, i) => expect(v).toBeCloseTo([0.75, 0.5, 0.25][i]!, 6));
    expect(applyLutRgb([1, 0, 0], invert, 0.5)).toEqual([0.5, 0.5, 0.5]);
  });

  it('matches the reference in the fast pixel path', () => {
    // A non-linear LUT, so interpolation errors would show.
    const lut = makeLut(9, (r, g, b) => [r * r, Math.sqrt(g), (r + b) / 2]);
    const pixels = new Uint8ClampedArray([12, 200, 99, 255, 255, 0, 128, 77, 0, 0, 0, 1]);
    const expected = [...pixels];
    for (let i = 0; i < pixels.length; i += 4) {
      const rgb = applyLutRgb(
        [pixels[i]! / 255, pixels[i + 1]! / 255, pixels[i + 2]! / 255],
        lut,
        0.7,
      );
      // applyLutRgb already blends by intensity.
      for (let c = 0; c < 3; c++) expected[i + c] = Math.round(rgb[c]! * 255);
    }
    lutPixels(pixels, lut, 0.7);
    for (let i = 0; i < pixels.length; i++) {
      if (i % 4 === 3) continue; // alpha untouched
      expect(Math.abs(pixels[i]! - expected[i]!)).toBeLessThanOrEqual(1);
    }
    expect([pixels[3], pixels[7], pixels[11]]).toEqual([255, 77, 1]);
  });
});

describe('storing a LUT', () => {
  it('round-trips at 16-bit precision', () => {
    const lut = makeLut(5, (r, g, b) => [r * 0.3, g ** 2, 1 - b]);
    const restored = decodeLut(5, encodeLut(lut));
    expect(restored.size).toBe(5);
    restored.data.forEach((v, i) => expect(Math.abs(v - lut.data[i]!)).toBeLessThan(1 / 65535));
  });

  it('rejects data that does not fit', () => {
    expect(() => decodeLut(3, encodeLut(makeLut(2)))).toThrow(CubeError);
  });
});

describe('toHalf', () => {
  /** Decode an IEEE half-float bit pattern (positive values). */
  const fromHalf = (h: number) => {
    const exponent = h >> 10;
    const mantissa = h & 0x3ff;
    return exponent === 0 ? mantissa * 2 ** -24 : (1 + mantissa / 1024) * 2 ** (exponent - 15);
  };

  it('encodes known values exactly', () => {
    expect(toHalf(0)).toBe(0);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(2 ** -15)).toBe(512); // subnormal
    expect(toHalf(-1)).toBe(0); // clamped to the LUT range
  });

  it('round-trips 0..1 within half-float precision', () => {
    for (let i = 0; i <= 1000; i++) {
      const v = i / 1000;
      // 11 significant bits: relative error under 2^-11, and tiny values absolutely close.
      expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(
        Math.max(v * 2 ** -11, 2 ** -25),
      );
    }
  });
});
