import type { Layer } from '../engine/types';

/** Output resolution of the composition (Phase 3 adds aspect-ratio presets). */
export const COMPOSITION = { width: 1920, height: 1080 } as const;

export interface AssetInfo {
  id: string;
  name: string;
  durationUs: number;
  width: number;
  height: number;
  codec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export type RendererBackend = 'webgpu' | 'canvas2d';

/** Main thread -> render worker. */
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'addAsset'; id: string; file: File }
  | { type: 'render'; requestId: number; layers: Layer[] };

/** Render worker -> main thread. */
export type FromWorker =
  | { type: 'ready'; backend: RendererBackend }
  | { type: 'assetReady'; asset: AssetInfo }
  | { type: 'assetError'; id: string; message: string }
  | { type: 'rendered'; requestId: number; ms: number }
  | { type: 'error'; message: string };
