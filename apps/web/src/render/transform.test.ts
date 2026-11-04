import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type Transform } from '../engine/types';
import { apply, layerMatrix, toClipSpace, type Affine } from './transform';

const t = (patch: Partial<Transform> = {}): Transform => ({ ...IDENTITY_TRANSFORM, ...patch });

/** Round to 3 decimals; `+ 0` turns −0 into 0 so equality checks are exact. */
const round = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** The four corners of the source (unit square), mapped. */
const corners = (m: Affine) =>
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x, y]) => apply(m, x!, y!).map(round));

describe('layerMatrix', () => {
  it('fills the frame with a matching aspect ratio (identity)', () => {
    expect(corners(layerMatrix(1280, 720, 1920, 1080, t()))).toEqual([
      [0, 0],
      [1920, 0],
      [0, 1080],
      [1920, 1080],
    ]);
  });

  it('pillarboxes a 4:3 source', () => {
    const [topLeft, , , bottomRight] = corners(layerMatrix(640, 480, 1920, 1080, t()));
    expect(topLeft).toEqual([240, 0]);
    expect(bottomRight).toEqual([1680, 1080]);
  });

  it('scales about the centre and moves the centre', () => {
    const half = corners(layerMatrix(1920, 1080, 1920, 1080, t({ scalePercent: 50 })));
    expect(half[0]).toEqual([480, 270]);
    expect(half[3]).toEqual([1440, 810]);
    // Picture-in-picture: 25% size, centred at 80%/80% of the frame.
    const pip = corners(
      layerMatrix(1920, 1080, 1920, 1080, t({ scalePercent: 25, x: 800, y: 800 })),
    );
    expect(pip[0]).toEqual([1296, 729]);
    expect(pip[3]).toEqual([1776, 999]);
  });

  it('rotates clockwise around the centre', () => {
    // A 90° turn: the top-left corner of the source ends up top-right.
    const [topLeft] = corners(layerMatrix(1000, 1000, 1000, 1000, t({ rotationDeg: 90 })));
    expect(topLeft).toEqual([1000, 0]);
  });

  it('handles off-frame positions', () => {
    const [topLeft] = corners(layerMatrix(1920, 1080, 1920, 1080, t({ x: -500 })));
    expect(topLeft![0]).toBe(-1920);
  });
});

describe('toClipSpace', () => {
  it('maps the canvas to −1..1 with y up', () => {
    const full = toClipSpace(layerMatrix(1920, 1080, 1920, 1080, t()), 1920, 1080);
    expect(corners(full)).toEqual([
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]);
  });

  it('agrees with the pixel transform for any point', () => {
    const pixel = layerMatrix(
      1280,
      720,
      1920,
      1080,
      t({ scalePercent: 40, rotationDeg: 30, x: 300, y: 650 }),
    );
    const clip = toClipSpace(pixel, 1920, 1080);
    const [px, py] = apply(pixel, 0.3, 0.7);
    const [cx, cy] = apply(clip, 0.3, 0.7);
    expect(cx).toBeCloseTo((px / 1920) * 2 - 1);
    expect(cy).toBeCloseTo(1 - (py / 1080) * 2);
  });
});
