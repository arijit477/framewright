import { create } from 'zustand';
import { DEFAULT_SILENCE, type SilenceOptions } from '../silence/detect';
import { SilenceJob } from '../silence/client';
import { flushPendingEdits } from '../lib/pending-edits';
import { notify, pause, projectForExport, removeSilences, useEditor } from './editor';

const OPTIONS_KEY = 'framewright.silenceOptions';

export interface SilenceState {
  open: boolean;
  /** The clips to analyse (chosen when the dialog opens). */
  clipIds: number[];
  options: SilenceOptions;
  phase: 'idle' | 'running' | 'error';
  fraction: number;
  error: string | null;
}

function loadOptions(): SilenceOptions {
  try {
    const saved = JSON.parse(
      globalThis.localStorage?.getItem(OPTIONS_KEY) ?? 'null',
    ) as Partial<SilenceOptions> | null;
    const pick = (key: keyof SilenceOptions) =>
      typeof saved?.[key] === 'number' && Number.isFinite(saved[key])
        ? saved[key]
        : DEFAULT_SILENCE[key];
    return {
      thresholdDb: pick('thresholdDb'),
      minSilenceUs: pick('minSilenceUs'),
      marginUs: pick('marginUs'),
    };
  } catch {
    return { ...DEFAULT_SILENCE };
  }
}

export const useSilence = create<SilenceState>(() => ({
  open: false,
  clipIds: [],
  options: loadOptions(),
  phase: 'idle',
  fraction: 0,
  error: null,
}));

const set = useSilence.setState;
const get = useSilence.getState;
let job: SilenceJob | null = null;

/** The clips whose own sound can be analysed: media clips with audio that isn't muted. */
export function clipsWithSound(clipIds: readonly number[]): number[] {
  const { timeline, assets } = useEditor.getState();
  const clips = timeline.tracks.flatMap((t) => t.clips);
  return clipIds.filter((id) => {
    const clip = clips.find((c) => c.id === id);
    return clip && !clip.text && !clip.muted && assets[clip.assetId]?.hasAudio;
  });
}

export function openSilence(clipIds: readonly number[]): void {
  set({ open: true, clipIds: [...clipIds], phase: 'idle', error: null });
}

export function closeSilence(): void {
  cancelSilence();
  set({ open: false });
}

export function setSilenceOptions(patch: Partial<SilenceOptions>): void {
  const options = { ...get().options, ...patch };
  set({ options });
  try {
    globalThis.localStorage?.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Not remembered; still used now.
  }
}

export function resetSilenceOptions(): void {
  setSilenceOptions(DEFAULT_SILENCE);
}

/** Analyse the clips, then cut their silences (one undo step). */
export function startSilence(): void {
  if (job) return;
  flushPendingEdits();
  pause();
  const clipIds = clipsWithSound(get().clipIds);
  if (clipIds.length === 0) {
    set({ phase: 'error', error: 'The selected clips have no sound to analyse.' });
    return;
  }
  const { projectJson, assets } = projectForExport();
  set({ phase: 'running', fraction: 0, error: null });
  job = new SilenceJob(
    { projectJson, assets, clipIds, options: get().options },
    {
      onProgress: (fraction) => set({ fraction }),
      onDone: (silences) => {
        job = null;
        const result = removeSilences(silences);
        if (!result) {
          set({ phase: 'error', error: 'No silences long enough to cut were found.' });
          return;
        }
        set({ open: false, phase: 'idle' });
        const seconds = (result.removedUs / 1e6).toFixed(1);
        notify(
          'info',
          `Removed ${result.count} silence${result.count === 1 ? '' : 's'} (${seconds} s).`,
        );
      },
      onError: (message) => {
        job = null;
        set({ phase: 'error', error: message });
      },
    },
  );
}

export function cancelSilence(): void {
  job?.cancel();
  job = null;
  if (get().phase === 'running') set({ phase: 'idle' });
}
