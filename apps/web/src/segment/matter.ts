/**
 * Background removal in the preview and export workers: a mask for a frame,
 * from MediaPipe's selfie segmentation on ONNX Runtime (the engine the app
 * already bundles). Loaded on first use (`loadMatter`), so projects without
 * background removal never fetch the model or the runtime.
 */
import type { VideoSample } from 'mediabunny';
import * as ort from 'onnxruntime-web/webgpu';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { cachedModel } from '../lib/model-cache';
import { maskPixels, MATTE_INPUT, MATTE_MODEL, toMatteInput } from './matte';

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

export class Matter {
  private readonly canvas = new OffscreenCanvas(MATTE_INPUT, MATTE_INPUT);
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  /** One frame at a time: the session isn't re-entrant. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly session: ort.InferenceSession) {}

  static async create(): Promise<Matter> {
    const bytes = await cachedModel(MATTE_MODEL.url, 'background removal model');
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
      executionProviders: ['wasm'],
    });
    return new Matter(session);
  }

  /** The frame's mask: 256×256, white, alpha = person. Stretch it over the frame to apply it. */
  mask(sample: VideoSample): Promise<ImageBitmap> {
    const run = this.queue.then(async () => {
      sample.draw(this.ctx, 0, 0, MATTE_INPUT, MATTE_INPUT);
      const { data } = this.ctx.getImageData(0, 0, MATTE_INPUT, MATTE_INPUT);
      const input = new ort.Tensor('float32', toMatteInput(data), [1, 3, MATTE_INPUT, MATTE_INPUT]);
      const out = await this.session.run({ [this.session.inputNames[0]!]: input });
      const alphas = out[this.session.outputNames[0]!]!.data as Float32Array;
      const image = new ImageData(maskPixels(alphas), MATTE_INPUT, MATTE_INPUT);
      return await createImageBitmap(image);
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

let loading: Promise<Matter> | null = null;

/** The worker's matter, created on first use (and retried after a failed load). */
export function loadMatter(): Promise<Matter> {
  loading ??= Matter.create().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
