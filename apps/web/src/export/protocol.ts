import type { ExportSettings } from './settings';

/** Folder in browser storage (OPFS) where exports are written before download. */
export const EXPORTS_DIR = 'exports';

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
      destination: ExportDestination;
    }
  | { type: 'cancel' };

/**
 * Where the encoded file goes. Exports stream to disk, so even long 4K renders
 * never have to fit in memory:
 * - `file`: a file the user picked with the Save dialog (Chrome, Edge);
 * - `auto`: browser storage (OPFS), downloaded from there, or memory as a last
 *   resort on browsers without OPFS.
 */
export type ExportDestination = { type: 'file'; handle: FileSystemFileHandle } | { type: 'auto' };

/** Where the finished file ended up. */
export type ExportOutput =
  | { kind: 'file'; bytes: number }
  | { kind: 'storage'; name: string; bytes: number }
  | { kind: 'memory'; buffer: ArrayBuffer; bytes: number };

export interface ExportResult {
  output: ExportOutput;
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
