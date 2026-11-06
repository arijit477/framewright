import type { Layer } from '../engine/types';

export interface AssetInfo {
  id: string;
  name: string;
  durationUs: number;
  width: number;
  height: number;
  codec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** A still image: one picture, any length. */
  still?: boolean;
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
  /** The project's frame shape changed: draw at this size from now on. */
  | { type: 'resize'; width: number; height: number }
  | { type: 'render'; requestId: number; layers: Layer[] };

/** Render worker -> main thread. */
export type FromWorker =
  | { type: 'ready'; backend: RendererBackend }
  | { type: 'assetReady'; asset: AssetInfo }
  | { type: 'assetError'; id: string; message: string }
  | { type: 'rendered'; requestId: number; ms: number }
  | { type: 'error'; message: string }
  /** Something the user should know, but the preview carries on (e.g. background removal is unavailable). */
  | { type: 'notice'; message: string };
