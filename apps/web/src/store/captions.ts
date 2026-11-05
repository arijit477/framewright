import { create } from 'zustand';
import { CaptionJob } from '../captions/client';
import {
  CAPTION_MODELS,
  type CaptionModel,
  type CaptionStage,
  type SpeechDevice,
} from '../captions/protocol';
import { captionsFromWords } from '../captions/segments';
import { flushPendingEdits } from '../lib/pending-edits';
import { addCaptions, notify, pause, projectForExport, selectClip, useEditor } from './editor';

const MODEL_KEY = 'framewright.captionModel';
export const FELL_BACK =
  'The graphics card couldn’t run the speech model, so the processor was used (slower).';
const GPU_KEY = 'framewright.captionUseGpu';

export interface CaptionsState {
  open: boolean;
  phase: 'idle' | 'running' | 'error';
  stage: CaptionStage;
  /** 0..1 within the stage. */
  fraction: number;
  error: string | null;
  model: CaptionModel;
  /** ISO 639-1 code, or null to detect it. */
  language: string | null;
  /** Colour each word as it's spoken. */
  highlight: boolean;
  /** Whether this browser offers a graphics card (WebGPU); null until checked. */
  gpuAvailable: boolean | null;
  /** The user's choice to use it when it's there (remembered). */
  useGpu: boolean;
  /** This run moved to the processor because the graphics card failed. */
  fellBack: boolean;
}

function loadUseGpu(): boolean {
  try {
    return globalThis.localStorage?.getItem(GPU_KEY) !== 'false';
  } catch {
    return true;
  }
}

function loadModel(): CaptionModel {
  try {
    const saved = globalThis.localStorage?.getItem(MODEL_KEY);
    return saved && saved in CAPTION_MODELS ? (saved as CaptionModel) : 'base';
  } catch {
    return 'base';
  }
}

export const useCaptions = create<CaptionsState>(() => ({
  open: false,
  phase: 'idle',
  stage: 'audio',
  fraction: 0,
  error: null,
  model: loadModel(),
  language: null,
  highlight: true,
  gpuAvailable: null,
  useGpu: loadUseGpu(),
  fellBack: false,
}));

/** Where the next run goes: the graphics card if there is one and it's wanted. */
export function speechDevice(state: CaptionsState = useCaptions.getState()): SpeechDevice {
  return state.gpuAvailable && state.useGpu ? 'gpu' : 'cpu';
}

/** The download for the chosen model on the device the next run will use. */
export function downloadMb(model: CaptionModel, state?: CaptionsState): number {
  return CAPTION_MODELS[model].downloadMb[speechDevice(state)];
}

const set = useCaptions.setState;
const get = useCaptions.getState;
let job: CaptionJob | null = null;

export function openCaptions(): void {
  set({ open: true, phase: 'idle', error: null });
  if (get().gpuAvailable === null) void checkGpu();
}

/** Ask for a WebGPU adapter once; the answer doesn't change while the page is open. */
async function checkGpu(): Promise<void> {
  let available = false;
  try {
    available = !!(await navigator.gpu?.requestAdapter());
  } catch {
    // No WebGPU.
  }
  set({ gpuAvailable: available });
}

export function closeCaptions(): void {
  cancelCaptions();
  set({ open: false });
}

export function setCaptionOptions(options: {
  model?: CaptionModel;
  language?: string | null;
  highlight?: boolean;
  useGpu?: boolean;
}) {
  set(options);
  if (options.useGpu !== undefined) {
    try {
      globalThis.localStorage?.setItem(GPU_KEY, String(options.useGpu));
    } catch {
      // Not remembered; still used now.
    }
  }
  if (options.model) {
    try {
      globalThis.localStorage?.setItem(MODEL_KEY, options.model);
    } catch {
      // Not remembered; still used now.
    }
  }
}

/**
 * Transcribe the project's sound and add the captions on a new track. The
 * whole run happens in a worker; the result is one undo step.
 */
export function startCaptions(): void {
  if (job) return;
  flushPendingEdits();
  pause();
  const { projectJson, assets, durationUs } = projectForExport();
  const { timeline, assets: media } = useEditor.getState();
  const hasSound = timeline.tracks.some((t) =>
    t.clips.some((c) => !c.muted && c.volumePercent > 0 && media[c.assetId]?.hasAudio),
  );
  if (durationUs === 0 || !hasSound) {
    set({ phase: 'error', error: 'There’s no sound on the timeline to caption.' });
    return;
  }
  const { model, language } = get();
  const device = speechDevice();
  set({ phase: 'running', stage: 'audio', fraction: 0, error: null, fellBack: false });
  job = new CaptionJob(
    { projectJson, assets, model, language, device },
    {
      onProgress: (stage, fraction) => set({ stage, fraction }),
      onFallback: (reason) => {
        console.warn('Captions: the graphics card failed, so the processor is used.', reason);
        set({ fellBack: true, stage: 'audio', fraction: 0 });
      },
      onDone: (words, duration) => {
        job = null;
        const captions = captionsFromWords(words, duration);
        if (captions.length === 0) {
          set({ phase: 'error', error: 'No speech was found in the sound.' });
          return;
        }
        if (addCaptions(captions, { highlight: get().highlight }) === null) {
          set({ phase: 'error', error: 'The captions couldn’t be added.' });
          return;
        }
        selectClip(null);
        set({ open: false, phase: 'idle' });
        notify(
          'info',
          `Added ${captions.length} caption${captions.length === 1 ? '' : 's'} on a new track.` +
            (get().fellBack ? ` ${FELL_BACK}` : ''),
        );
      },
      onError: (message) => {
        job = null;
        set({ phase: 'error', error: message });
      },
    },
  );
}

export function cancelCaptions(): void {
  job?.cancel();
  job = null;
  if (get().phase === 'running') set({ phase: 'idle' });
}
