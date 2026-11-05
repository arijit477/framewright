import type { ExportAsset } from '../export/protocol';
import type { SilenceOptions } from './detect';

/** Main thread -> silence worker. */
export type ToSilenceWorker = {
  type: 'start';
  /** The project as saved by the engine. */
  projectJson: string;
  assets: ExportAsset[];
  /** The clips to analyse (each on its own: other clips' sound doesn't count). */
  clipIds: number[];
  options: SilenceOptions;
};

/** Silence worker -> main thread. */
export type FromSilenceWorker =
  | { type: 'progress'; fraction: number }
  /** Per clip, the silent [start, end) ranges in timeline µs. */
  | { type: 'done'; silences: { clipId: number; ranges: [number, number][] }[] }
  | { type: 'error'; message: string };
