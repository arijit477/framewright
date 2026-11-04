import type { ExportAsset } from '../export/protocol';
import type { TimedText } from './segments';

/**
 * Speech-recognition models: OpenAI's Whisper (Apache-2.0), in Hugging Face's
 * ONNX conversions exported with cross-attention outputs, which word-level
 * timestamps need, at 8-bit precision. These repos carry no licence label of
 * their own; they declare `openai/whisper-*` as their base model, and the
 * licence follows that (see docs/DEPENDENCIES.md). Revisions are pinned, so
 * every user gets exactly the files that were tested.
 */
export const CAPTION_MODELS = {
  tiny: {
    label: 'Fast',
    repo: 'onnx-community/whisper-tiny_timestamped',
    revision: '517244293732ee2d58139af5814231b7e6830a0d',
    downloadMb: 41,
  },
  base: {
    label: 'Accurate',
    repo: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
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
  /** Every recognised word with its time, in timeline seconds. */
  | { type: 'done'; words: TimedText[]; durationUs: number }
  | { type: 'error'; message: string };
