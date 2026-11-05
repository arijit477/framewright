import type { ExportAsset } from '../export/protocol';
import type { TimedText } from './segments';

/**
 * Speech-recognition models: OpenAI's Whisper (Apache-2.0), in Hugging Face's
 * ONNX conversions exported with cross-attention outputs, which word-level
 * timestamps need, at 8-bit precision. These repos carry no licence label of
 * their own; they declare `openai/whisper-*` as their base model, and the
 * licence follows that (see docs/DEPENDENCIES.md). Revisions are pinned, so
 * every user gets exactly the files that were tested. Download sizes are per
 * device: the graphics card needs the encoder at full precision (see
 * `MODEL_FILES`).
 */
export const CAPTION_MODELS = {
  tiny: {
    label: 'Fast',
    repo: 'onnx-community/whisper-tiny_timestamped',
    revision: '517244293732ee2d58139af5814231b7e6830a0d',
    downloadMb: { cpu: 41, gpu: 64 },
  },
  base: {
    label: 'Accurate',
    repo: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
    downloadMb: { cpu: 77, gpu: 136 },
  },
} as const;

export type CaptionModel = keyof typeof CAPTION_MODELS;

/** Where recognition runs: the graphics card (WebGPU) or the processor (WebAssembly). */
export type SpeechDevice = 'gpu' | 'cpu';

/**
 * Which model files run where. Whisper is an encoder (most of the work: once
 * per 30 s of audio) and a decoder (one small step per word piece).
 *
 * - **Processor:** both 8-bit, the smallest download.
 * - **Graphics card:** the encoder at full precision on the GPU, because
 *   ONNX Runtime's WebGPU backend has no kernels for the 8-bit files'
 *   integer operators (`MatMulInteger`, `ConvInteger`, `DynamicQuantizeLinear`)
 *   and would quietly run them on the processor. The decoder stays 8-bit on the
 *   processor, which suits its many tiny steps (and is the same file, so it's
 *   shared with processor runs).
 */
export const MODEL_FILES = {
  cpu: { device: 'wasm', dtype: 'q8' },
  gpu: {
    device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' },
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
  },
} as const;

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
  /** Where to run; the graphics card falls back to the processor if it fails. */
  device: SpeechDevice;
};

/** Captions worker -> main thread. */
export type FromCaptionsWorker =
  | { type: 'progress'; stage: CaptionStage; fraction: number }
  /** Every recognised word with its time, in timeline seconds. */
  | { type: 'done'; words: TimedText[]; durationUs: number; device: SpeechDevice }
  /** The graphics card couldn't run the model; the run should restart on the processor. */
  | { type: 'fallback'; reason: string }
  | { type: 'error'; message: string };
