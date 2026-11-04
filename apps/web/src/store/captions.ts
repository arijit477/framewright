import { create } from 'zustand';
import { CaptionJob } from '../captions/client';
import { CAPTION_MODELS, type CaptionModel, type CaptionStage } from '../captions/protocol';
import { captionsFromWords } from '../captions/segments';
import { flushPendingEdits } from '../lib/pending-edits';
import { addCaptions, notify, pause, projectForExport, selectClip, useEditor } from './editor';

const MODEL_KEY = 'framewright.captionModel';

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
}));

const set = useCaptions.setState;
const get = useCaptions.getState;
let job: CaptionJob | null = null;

export const openCaptions = () => set({ open: true, phase: 'idle', error: null });

export function closeCaptions(): void {
  cancelCaptions();
  set({ open: false });
}

export function setCaptionOptions(options: {
  model?: CaptionModel;
  language?: string | null;
  highlight?: boolean;
}) {
  set(options);
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
  set({ phase: 'running', stage: 'audio', fraction: 0, error: null });
  job = new CaptionJob(
    { projectJson, assets, model, language },
    {
      onProgress: (stage, fraction) => set({ stage, fraction }),
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
          `Added ${captions.length} caption${captions.length === 1 ? '' : 's'} on a new track.`,
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
