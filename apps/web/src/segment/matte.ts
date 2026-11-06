/**
 * Background removal: the pure parts. MediaPipe's selfie segmentation takes a
 * 256×256 RGB picture (the frame, stretched; values 0..1) and gives, for each
 * of its pixels, how likely it belongs to a person (0..1). That becomes the
 * alpha of a 256×256 mask, stretched back over the frame when drawn (so it
 * lines up exactly, whatever the frame's shape).
 */

export const MATTE_INPUT = 256;

/**
 * The selfie segmentation model (Apache-2.0), 0.5 MB, at full precision: the
 * 8-bit file runs several times slower here (integer kernels). Pinned, so every
 * user runs the file that was tested.
 */
export const MATTE_MODEL = {
  url: 'https://huggingface.co/onnx-community/mediapipe_selfie_segmentation/resolve/be49485c8e027524be38591817fc5cd31bd9d00e/onnx/model.onnx',
  downloadMb: 0.5,
} as const;

/** RGBA pixels (input-sized) as the model's input: channels first, 0..1. */
export function toMatteInput(rgba: Uint8ClampedArray): Float32Array {
  const pixels = MATTE_INPUT * MATTE_INPUT;
  const data = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) data[c * pixels + i] = rgba[i * 4 + c]! / 255;
  }
  return data;
}

/**
 * Below `LOW` a pixel is background, above `HIGH` the person, smoothly in
 * between. Cuts the faint halo the model leaves around a person (bits of the
 * background at 10–30%) while keeping a soft edge.
 */
export const EDGE = { low: 0.3, high: 0.7 } as const;

/** The model's output (0..1 per pixel) as mask pixels: white, with the matte as alpha. */
export function maskPixels(alphas: Float32Array, edge = EDGE): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(alphas.length * 4);
  const span = edge.high - edge.low;
  for (let i = 0; i < alphas.length; i++) {
    const t = Math.min(1, Math.max(0, (alphas[i]! - edge.low) / span));
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255); // smoothstep
  }
  return out;
}
