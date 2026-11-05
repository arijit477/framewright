/**
 * Transformers.js setup shared by the captions and translation workers: models
 * only from Hugging Face (pinned revisions), and the ONNX Runtime engine that
 * ships with the app instead of coming from a CDN at run time.
 */
import { env } from '@huggingface/transformers';
// The asyncify build holds both the processor (WebAssembly) and the WebGPU backends.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

/** Overall download progress over a model's files, which each report their own. */
export function downloadProgress(onFraction: (fraction: number) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== 'progress' || !info.file || !info.total) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
    const all = [...files.values()];
    onFraction(all.reduce((n, f) => n + f.loaded, 0) / all.reduce((n, f) => n + f.total, 0));
  };
}
