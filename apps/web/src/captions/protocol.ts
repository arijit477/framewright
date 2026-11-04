import type { ExportAsset } from '../export/protocol';
import type { TimedText } from './segments';

/**
 * Speech-recognition models: OpenAI's Whisper, converted for Transformers.js
 * (Apache-2.0), at 8-bit precision. Revisions are pinned, so every user gets
 * exactly the files that were tested, and the browser caches them by URL.
 */
export const CAPTION_MODELS = {
  tiny: {
    label: 'Fast',
    repo: 'Xenova/whisper-tiny',
    revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
    downloadMb: 41,
  },
  base: {
    label: 'Accurate',
    repo: 'Xenova/whisper-base',
    revision: '64da57285918e20ea79ea5c88eed7197933abaa8',
    downloadMb: 77,
  },
} as const;

export type CaptionModel = keyof typeof CAPTION_MODELS;

/** Whisper's sample rate: audio is mixed down to 16 kHz mono for it. */
export const SPEECH_SAMPLE_RATE = 16_000;

export type CaptionStage = 'audio' | 'model' | 'speech';

/** Main thread -> captions worker. */
export type ToCaptionsWorker = {
  type: 'start';
  /** The project as saved by the engine; its whole mix is transcribed. */
  projectJson: string;
  assets: ExportAsset[];
  model: CaptionModel;
  /** An ISO 639-1 code, or null to detect the language. */
  language: string | null;
};

/** Captions worker -> main thread. */
export type FromCaptionsWorker =
  | { type: 'progress'; stage: CaptionStage; fraction: number }
  | { type: 'done'; phrases: TimedText[]; durationUs: number }
  | { type: 'error'; message: string };
