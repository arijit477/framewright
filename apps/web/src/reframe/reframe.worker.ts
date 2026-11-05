/**
 * Reframe worker: finds the faces in a clip's frames, a few times a second,
 * with a small face detector run by ONNX Runtime (the same engine the
 * captions use). The model downloads once and is kept by the browser.
 */
import { CanvasSink } from 'mediabunny';
import * as ort from 'onnxruntime-web/webgpu';
// The bundled ONNX Runtime engine (the same files the captions use).
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { openAsset } from '../media/asset';
import { decodeFaces, DETECTOR_INPUT, letterbox, toInput } from './faces';
import type { FrameFaces } from './path';
import {
  FACE_MODEL,
  SAMPLE_INTERVAL_US,
  type FromReframeWorker,
  type ToReframeWorker,
} from './protocol';

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

const send = (message: FromReframeWorker) => self.postMessage(message);

self.onmessage = (event: MessageEvent<ToReframeWorker>) => {
  run(event.data).catch((error: unknown) =>
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};

/** The model's bytes, from the browser's cache after the first time. */
async function modelBytes(): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open('framewright-models');
    const hit = await cache.match(FACE_MODEL.url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // No cache storage (e.g. private browsing): download each time.
  }
  const response = await fetch(FACE_MODEL.url);
  if (!response.ok)
    throw new Error(`The face detector couldn’t be downloaded (${response.status}).`);
  if (cache) await cache.put(FACE_MODEL.url, response.clone()).catch(() => {});
  return await response.arrayBuffer();
}

async function run({ file, sourceFrom, sourceTo }: ToReframeWorker) {
  const { video } = await openAsset(file);
  if (!video) throw new Error('This clip has no picture to reframe.');
  const session = await ort.InferenceSession.create(new Uint8Array(await modelBytes()), {
    executionProviders: ['wasm'],
  });
  const width = video.displayWidth;
  const height = video.displayHeight;
  const placement = letterbox(width, height);
  const times: number[] = [];
  for (let t = sourceFrom; t < sourceTo; t += SAMPLE_INTERVAL_US) times.push(t);
  if (times.length === 0) times.push(sourceFrom);

  const sink = new CanvasSink(video, { ...DETECTOR_INPUT, fit: 'contain' });
  const frames: FrameFaces[] = [];
  let n = 0;
  try {
    for await (const wrapped of sink.canvasesAtTimestamps(times.map((t) => t / 1e6))) {
      const sourceTime = times[n++]!;
      if (!wrapped) {
        frames.push({ sourceTime, faces: [] });
        continue;
      }
      const ctx = (wrapped.canvas as OffscreenCanvas).getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, DETECTOR_INPUT.width, DETECTOR_INPUT.height);
      const input = new ort.Tensor('float32', toInput(data), [
        1,
        3,
        DETECTOR_INPUT.height,
        DETECTOR_INPUT.width,
      ]);
      const out = await session.run({ [session.inputNames[0]!]: input });
      const scores = out[session.outputNames[0]!]!.data as Float32Array;
      const boxes = out[session.outputNames[1]!]!.data as Float32Array;
      frames.push({ sourceTime, faces: decodeFaces(scores, boxes, placement) });
      send({ type: 'progress', fraction: n / times.length });
    }
  } finally {
    await session.release();
  }
  send({ type: 'done', frames, width, height });
}
