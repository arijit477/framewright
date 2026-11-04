import { create } from 'zustand';
import { ExportJob } from '../export/client';
import {
  EXPORTS_DIR,
  type ExportDestination,
  type ExportOutput,
  type ExportResult,
} from '../export/protocol';
import {
  DEFAULT_EXPORT_SETTINGS,
  exportFileName,
  FORMATS,
  sanitizeSettings,
  type ExportSettings,
} from '../export/settings';
import { flushPendingEdits } from '../lib/pending-edits';
import { pause, projectForExport } from './editor';

const SETTINGS_KEY = 'framewright.exportSettings';

export type ExportPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface ExportState {
  open: boolean;
  settings: ExportSettings;
  phase: ExportPhase;
  progress: { framesDone: number; totalFrames: number; elapsedMs: number } | null;
  /** `url` is null when the file was saved straight to disk (nothing to download). */
  result:
    (Omit<ExportResult, 'output'> & { url: string | null; fileName: string; bytes: number }) | null;
  error: string | null;
}

export const useExport = create<ExportState>(() => ({
  open: false,
  settings: loadSettings(),
  phase: 'idle',
  progress: null,
  result: null,
  error: null,
}));

const set = useExport.setState;
const get = useExport.getState;
let job: ExportJob | null = null;

export function openExport() {
  set({ open: true });
}

/** Close the dialog. A running export keeps going and can be reopened. */
export function closeExport() {
  set({ open: false });
  if (get().phase !== 'running') reset();
}

export function updateSettings(patch: Partial<ExportSettings>) {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  saveSettings(settings);
}

/**
 * Start an export. Where the browser supports it (Chrome, Edge), the Save
 * dialog comes first and the export streams straight into the chosen file;
 * otherwise it streams into browser storage and is downloaded from there.
 * Must be called from a click: browsers only show the Save dialog then.
 */
export async function startExport() {
  if (job || get().phase === 'running') return;
  flushPendingEdits(); // include a change made a moment ago (e.g. a slider still focused)
  pause();
  const { settings } = get();
  const { projectJson, assets, luts, baseName } = projectForExport();
  const fileName = exportFileName(baseName, settings);

  const destination = await chooseDestination(fileName, settings.format);
  if (!destination) return; // the user cancelled the Save dialog

  reset();
  void removeStoredExports(); // leftovers from earlier exports
  set({ phase: 'running', progress: { framesDone: 0, totalFrames: 0, elapsedMs: 0 } });

  job = new ExportJob(projectJson, assets, luts, settings, destination, {
    onProgress: (progress) => set({ progress }),
    onDone: ({ output, ...info }) => {
      job = null;
      describeOutput(output, info.mimeType, fileName, destination)
        .then((saved) => set({ phase: 'done', result: { ...info, ...saved } }))
        .catch((error: unknown) =>
          set({
            phase: 'error',
            error: `The file was rendered but couldn't be opened: ${String(error)}`,
          }),
        );
    },
    onCancelled: () => {
      job = null;
      set({ phase: 'cancelled', progress: null });
    },
    onError: (message) => {
      job = null;
      set({ phase: 'error', error: message, progress: null });
    },
  });
}

/** Ask for a file with the Save dialog if available; null if the user cancels. */
async function chooseDestination(
  fileName: string,
  format: ExportSettings['format'],
): Promise<ExportDestination | null> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) return { type: 'auto' };
  try {
    const handle = await picker({
      suggestedName: fileName,
      types: [
        {
          description: FORMATS[format].label,
          accept: { [MIME_TYPES[format]]: [`.${FORMATS[format].extension}`] },
        },
      ],
    });
    return { type: 'file', handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    return { type: 'auto' }; // e.g. not allowed here: fall back to browser storage
  }
}

/** Turn the worker's output into something the dialog can show (and download). */
async function describeOutput(
  output: ExportOutput,
  mimeType: string,
  fileName: string,
  destination: ExportDestination,
): Promise<{ url: string | null; fileName: string; bytes: number }> {
  switch (output.kind) {
    case 'file':
      // Already on disk where the user chose; nothing to download.
      return {
        url: null,
        fileName: destination.type === 'file' ? destination.handle.name : fileName,
        bytes: output.bytes,
      };
    case 'storage': {
      // A disk-backed File: the download streams from storage, not from memory.
      const file = await (await exportsDir()).getFileHandle(output.name).then((h) => h.getFile());
      return { url: URL.createObjectURL(file), fileName, bytes: output.bytes };
    }
    case 'memory':
      return {
        url: URL.createObjectURL(new Blob([output.buffer], { type: mimeType })),
        fileName,
        bytes: output.bytes,
      };
  }
}

async function exportsDir(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(EXPORTS_DIR, { create: true });
}

/**
 * Delete finished exports kept in browser storage for download. Runs before
 * the next export rather than right after a download starts, so a download
 * that's still reading the file is never cut short.
 */
async function removeStoredExports(): Promise<void> {
  try {
    const dir = await exportsDir();
    const names: string[] = [];
    for await (const [name] of dir.entries()) names.push(name);
    await Promise.all(names.map((name) => dir.removeEntry(name).catch(() => {})));
  } catch {
    // No OPFS: nothing stored.
  }
}

const MIME_TYPES: Record<ExportSettings['format'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

export function cancelExport() {
  job?.cancel();
}

/** Forget the previous result and free its memory. */
function reset() {
  const { result } = get();
  if (result?.url) URL.revokeObjectURL(result.url);
  set({ phase: 'idle', progress: null, result: null, error: null });
}

function loadSettings(): ExportSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? sanitizeSettings(JSON.parse(saved)) : DEFAULT_EXPORT_SETTINGS;
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

function saveSettings(settings: ExportSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings just won't persist.
  }
}
