import { create } from 'zustand';
import { LANGUAGE_NAMES } from '../captions/languages';
import { captionTranslations, sentenceInputs } from '../captions/sentences';
import { TranslationJob } from '../captions/translate-client';
import { targetLanguages, translationRoute, type TranslationStage } from '../captions/translation';
import { flushPendingEdits } from '../lib/pending-edits';
import { addTranslatedCaptions, captionClips, notify, selectClip } from './editor';
import { clipEnd } from '../engine/types';

const LANGUAGES_KEY = 'framewright.translationLanguages';

export interface TranslationState {
  open: boolean;
  /** The caption track being translated. */
  trackId: number | null;
  from: string;
  to: string;
  phase: 'idle' | 'running' | 'error';
  stage: TranslationStage;
  /** 0..1 within the stage. */
  fraction: number;
  /** Which model of the route is running (1-based), and how many there are. */
  step: number;
  steps: number;
  error: string | null;
}

/** The last languages used, if they still have a route. */
function loadLanguages(): { from: string; to: string } {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(LANGUAGES_KEY) ?? 'null') as {
      from?: unknown;
      to?: unknown;
    } | null;
    if (
      typeof saved?.from === 'string' &&
      typeof saved.to === 'string' &&
      translationRoute(saved.from, saved.to)
    ) {
      return { from: saved.from, to: saved.to };
    }
  } catch {
    // Use the defaults.
  }
  return { from: 'en', to: 'es' };
}

export const useTranslation = create<TranslationState>(() => ({
  open: false,
  trackId: null,
  ...loadLanguages(),
  phase: 'idle',
  stage: 'model',
  fraction: 0,
  step: 1,
  steps: 1,
  error: null,
}));

const set = useTranslation.setState;
const get = useTranslation.getState;
let job: TranslationJob | null = null;

export function openTranslation(trackId: number): void {
  flushPendingEdits(); // translate what's on screen, including an edit still being typed
  set({ open: true, trackId, phase: 'idle', error: null });
}

export function closeTranslation(): void {
  cancelTranslation();
  set({ open: false });
}

/** Choose languages; a target the new source can't reach moves to the first one it can. */
export function setTranslationLanguages({ from, to }: { from?: string; to?: string }): void {
  const next = { from: from ?? get().from, to: to ?? get().to };
  if (!translationRoute(next.from, next.to)) next.to = targetLanguages(next.from)[0] ?? next.to;
  set(next);
  try {
    globalThis.localStorage?.setItem(LANGUAGES_KEY, JSON.stringify(next));
  } catch {
    // Not remembered; still used now.
  }
}

/** Translate the track's captions into a new track (one undo step). */
export function startTranslation(): void {
  if (job) return;
  flushPendingEdits();
  const { trackId, from, to } = get();
  const route = translationRoute(from, to);
  const clips = trackId === null ? [] : captionClips(trackId);
  if (trackId === null || !route || clips.length === 0) {
    set({ phase: 'error', error: 'There are no captions on this track to translate.' });
    return;
  }
  set({ phase: 'running', stage: 'model', fraction: 0, step: 1, steps: route.length, error: null });
  // Whole sentences translate better than the caption-sized pieces they're split into.
  const cues = clips.map((c) => ({ text: c.text!.text, startUs: c.start, endUs: clipEnd(c) }));
  const { groups, texts } = sentenceInputs(cues);
  job = new TranslationJob(
    { texts, route },
    {
      onProgress: (stage, fraction, step, steps) => set({ stage, fraction, step, steps }),
      onDone: (translations) => {
        job = null;
        const captions = captionTranslations(cues, groups, translations, to);
        if (addTranslatedCaptions(trackId, captions) === null) {
          set({
            phase: 'error',
            error: 'The captions changed while translating. Please try again.',
          });
          return;
        }
        selectClip(null);
        set({ open: false, phase: 'idle' });
        notify(
          'info',
          `Translated ${captions.length} caption${captions.length === 1 ? '' : 's'} into ${
            LANGUAGE_NAMES[to]
          } on a new track.`,
        );
      },
      onError: (message) => {
        job = null;
        set({ phase: 'error', error: message });
      },
    },
  );
}

export function cancelTranslation(): void {
  job?.cancel();
  job = null;
  if (get().phase === 'running') set({ phase: 'idle' });
}
