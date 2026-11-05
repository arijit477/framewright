import { describe, expect, it } from 'vitest';
import { decodeFaces, letterbox, toInput } from './faces';

describe('letterbox', () => {
  it('fits a widescreen picture across the input, centred vertically', () => {
    const p = letterbox(1920, 1080);
    expect(p.left).toBe(0);
    expect(p.width).toBe(1);
    expect(p.height).toBeCloseTo(0.75, 5); // 320 wide → 180 of 240 high
    expect(p.top).toBeCloseTo(0.125, 5);
  });

  it('fits a vertical picture down the input, centred horizontally', () => {
    const p = letterbox(1080, 1920);
    expect(p.top).toBe(0);
    expect(p.height).toBe(1);
    expect(p.width).toBeCloseTo(135 / 320, 5);
  });
});

describe('toInput', () => {
  it('normalises channels first', () => {
    const rgba = new Uint8ClampedArray(320 * 240 * 4);
    rgba.set([255, 127, 0, 255], 0);
    const data = toInput(rgba);
    const plane = 320 * 240;
    expect([data[0], data[plane], data[2 * plane]]).toEqual([1, 0, -127 / 128]);
  });
});

describe('decodeFaces', () => {
  const placement = letterbox(1920, 1080);
  /** Candidates as [score, x0, y0, x1, y1] in input fractions. */
  const outputs = (...rows: number[][]) => ({
    scores: Float32Array.from(rows.flatMap(([s]) => [1 - s!, s!])),
    boxes: Float32Array.from(rows.flatMap(([, ...b]) => b)),
  });

  it('keeps confident faces, in source coordinates', () => {
    const { scores, boxes } = outputs([0.95, 0.4, 0.25, 0.5, 0.5], [0.3, 0.1, 0.1, 0.2, 0.2]);
    const faces = decodeFaces(scores, boxes, placement);
    expect(faces).toHaveLength(1);
    // y in the input: 0.25..0.5 → in the picture (0.125 offset, 0.75 tall): 0.1667..0.5
    expect(faces[0]!.x0).toBeCloseTo(0.4, 5);
    expect(faces[0]!.y0).toBeCloseTo((0.25 - 0.125) / 0.75, 5);
    expect(faces[0]!.y1).toBeCloseTo((0.5 - 0.125) / 0.75, 5);
  });

  it('merges overlapping boxes of the same face, keeping separate faces', () => {
    const { scores, boxes } = outputs(
      [0.9, 0.4, 0.3, 0.5, 0.5],
      [0.99, 0.41, 0.31, 0.51, 0.51], // the same face, more confident
      [0.8, 0.7, 0.3, 0.8, 0.5], // someone else
    );
    const faces = decodeFaces(scores, boxes, placement);
    expect(faces.map((f) => f.score)).toEqual([0.99, 0.8].map((s) => Math.fround(s)));
  });
});
