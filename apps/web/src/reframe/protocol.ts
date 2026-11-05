import type { FrameFaces } from './path';

/**
 * The face detector: UltraFace RFB-320 (Apache-2.0, from the ONNX Model Zoo;
 * originally MIT), 1.3 MB, pinned so every user runs the file that was tested.
 */
export const FACE_MODEL = {
  url: 'https://huggingface.co/onnxmodelzoo/version-RFB-320/resolve/6fd293d22b523ec88959f104b8eef5395e3adfbc/version-RFB-320.onnx',
  downloadMb: 1.3,
} as const;

/** How often frames are checked for faces (µs of source media). */
export const SAMPLE_INTERVAL_US = 250_000;

/** Main thread -> reframe worker. */
export type ToReframeWorker = {
  type: 'start';
  file: File;
  /** The part of the source the clip uses (µs). */
  sourceFrom: number;
  sourceTo: number;
};

/** Reframe worker -> main thread. */
export type FromReframeWorker =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; frames: FrameFaces[]; width: number; height: number }
  | { type: 'error'; message: string };
