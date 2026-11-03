import { create } from 'zustand';
import { ExportJob } from '../export/client';
import type { ExportResult } from '../export/protocol';
import {
  DEFAULT_EXPORT_SETTINGS,
  exportFileName,
  sanitizeSettings,
  type ExportSettings,
} from '../export/settings';
import { pause, projectForExport } from './editor';

const SETTINGS_KEY = 'framewright.exportSettings';

export type ExportPhase = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

export interface ExportState {
  open: boolean;
  settings: ExportSettings;
  phase: ExportPhase;
  progress: { framesDone: number; totalFrames: number; elapsedMs: number } | null;
  result: (Omit<ExportResult, 'buffer'> & { url: string; fileName: string; bytes: number }) | null;
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

export function startExport() {
  if (job) return;
  pause();
  reset();
  const { settings } = get();
  const { projectJson, assets, baseName } = projectForExport();
  const fileName = exportFileName(baseName, settings);
  set({ phase: 'running', progress: { framesDone: 0, totalFrames: 0, elapsedMs: 0 } });

  job = new ExportJob(projectJson, assets, settings, {
    onProgress: (progress) => set({ progress }),
    onDone: ({ buffer, ...info }) => {
      job = null;
      const blob = new Blob([buffer], { type: info.mimeType });
      set({
        phase: 'done',
        result: { ...info, url: URL.createObjectURL(blob), fileName, bytes: blob.size },
      });
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

export function cancelExport() {
  job?.cancel();
}

/** Forget the previous result and free its memory. */
function reset() {
  const { result } = get();
  if (result) URL.revokeObjectURL(result.url);
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
