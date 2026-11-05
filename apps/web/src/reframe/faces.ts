/**
 * Face detection input and output for UltraFace (RFB-320): a 320×240 RGB
 * picture in, a score and a box (corners, as fractions of the input) for each
 * of its 4,420 candidate positions out. The video frame is letterboxed into
 * the input (fitted, centred), so faces keep their shape.
 */
import type { Face } from './path';

export const DETECTOR_INPUT = { width: 320, height: 240 } as const;

/** Where a `sourceWidth`×`sourceHeight` picture lands in the detector's input when fitted. */
export function letterbox(sourceWidth: number, sourceHeight: number) {
  const { width, height } = DETECTOR_INPUT;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = (sourceWidth * scale) / width; // fraction of the input the picture covers
  const h = (sourceHeight * scale) / height;
  return { left: (1 - w) / 2, top: (1 - h) / 2, width: w, height: h };
}

/** RGBA pixels (input-sized) as the model's input: channels first, (v − 127) / 128. */
export function toInput(rgba: Uint8ClampedArray): Float32Array {
  const pixels = DETECTOR_INPUT.width * DETECTOR_INPUT.height;
  const data = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) data[c * pixels + i] = (rgba[i * 4 + c]! - 127) / 128;
  }
  return data;
}

export const FACE_SCORE = 0.7;
const OVERLAP = 0.3;

const iou = (a: Face, b: Face) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = w * h;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * Faces from the model's outputs (`scores`: [n, 2] background/face,
 * `boxes`: [n, 4] corners), as fractions of the source picture: confident
 * ones only, overlapping duplicates of the same face merged into the best.
 */
export function decodeFaces(
  scores: Float32Array,
  boxes: Float32Array,
  placement: ReturnType<typeof letterbox>,
  threshold = FACE_SCORE,
): Face[] {
  const candidates: Face[] = [];
  const toSource = (v: number, offset: number, size: number) =>
    Math.min(1, Math.max(0, (v - offset) / size));
  for (let i = 0; i < scores.length / 2; i++) {
    const score = scores[i * 2 + 1]!;
    if (score < threshold) continue;
    candidates.push({
      x0: toSource(boxes[i * 4]!, placement.left, placement.width),
      y0: toSource(boxes[i * 4 + 1]!, placement.top, placement.height),
      x1: toSource(boxes[i * 4 + 2]!, placement.left, placement.width),
      y1: toSource(boxes[i * 4 + 3]!, placement.top, placement.height),
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const faces: Face[] = [];
  for (const c of candidates) {
    if (c.x1 > c.x0 && c.y1 > c.y0 && faces.every((f) => iou(f, c) < OVERLAP)) faces.push(c);
  }
  return faces;
}
