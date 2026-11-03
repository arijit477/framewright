import type { ExportSettings } from './settings';

export interface ExportAsset {
  id: string;
  file: File;
}

/** Main thread -> export worker. */
export type ToExportWorker =
  | {
      type: 'start';
      /** The project as saved by the engine; the worker renders this snapshot. */
      projectJson: string;
      assets: ExportAsset[];
      settings: ExportSettings;
    }
  | { type: 'cancel' };

export interface ExportResult {
  buffer: ArrayBuffer;
  mimeType: string;
  videoCodec: string;
  audioCodec: string | null;
  frames: number;
  elapsedMs: number;
  /** Non-fatal problems, e.g. "audio could not be encoded". */
  warnings: string[];
}

/** Export worker -> main thread. */
export type FromExportWorker =
  | { type: 'progress'; framesDone: number; totalFrames: number; elapsedMs: number }
  | ({ type: 'done' } & ExportResult)
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
