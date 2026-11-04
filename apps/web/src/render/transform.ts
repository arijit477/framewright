import type { Transform } from '../engine/types';

/**
 * A 2D affine transform in the canvas convention:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 * (the arguments of CanvasRenderingContext2D.setTransform, in that order).
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Where a clip lands on the canvas: maps the unit square (the source frame,
 * y down) to canvas pixels. The source is first fitted to the canvas
 * (letterboxed or pillarboxed), then scaled about its centre, rotated
 * clockwise and moved so its centre is at the transform's position.
 *
 * Both compositors use this one function (Canvas 2D directly, WebGPU via
 * `toClipSpace`), so they can never disagree about placement.
 */
export function layerMatrix(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  transform: Transform,
): Affine {
  const fit = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const scale = transform.scalePercent / 100;
  const width = sourceWidth * fit * scale;
  const height = sourceHeight * fit * scale;
  const centreX = (transform.x / 1000) * canvasWidth;
  const centreY = (transform.y / 1000) * canvasHeight;
  const angle = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Unit square → centred on the origin → sized → rotated → moved to the centre.
  const a = cos * width;
  const b = sin * width;
  const c = -sin * height;
  const d = cos * height;
  return { a, b, c, d, e: centreX - a / 2 - c / 2, f: centreY - b / 2 - d / 2 };
}

/** Convert a canvas-pixel transform to WebGPU clip space (x and y in −1..1, y up). */
export function toClipSpace(m: Affine, canvasWidth: number, canvasHeight: number): Affine {
  return {
    a: (2 * m.a) / canvasWidth,
    b: (-2 * m.b) / canvasHeight,
    c: (2 * m.c) / canvasWidth,
    d: (-2 * m.d) / canvasHeight,
    e: (2 * m.e) / canvasWidth - 1,
    f: 1 - (2 * m.f) / canvasHeight,
  };
}

export const apply = (m: Affine, x: number, y: number): [number, number] => [
  m.a * x + m.c * y + m.e,
  m.b * x + m.d * y + m.f,
];
