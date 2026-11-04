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

/** A decoded project LUT, as sent to the workers. */
export interface LutData {
  id: string;
  size: number;
  data: Float32Array;
}

/** Main thread -> render worker. */
export type ToWorker =
  | { type: 'init'; canvas: OffscreenCanvas }
  | { type: 'addAsset'; id: string; file: File }
  /** Drop every asset (switching projects). */
  | { type: 'clearAssets' }
  /** Replace the project's LUTs. */
  | { type: 'setLuts'; luts: LutData[] }
  | { type: 'render'; requestId: number; layers: Layer[] };

/** Render worker -> main thread. */
export type FromWorker =
  | { type: 'ready'; backend: RendererBackend }
  | { type: 'assetReady'; asset: AssetInfo }
  | { type: 'assetError'; id: string; message: string }
  | { type: 'rendered'; requestId: number; ms: number }
  | { type: 'error'; message: string };
