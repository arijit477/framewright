/**
 * Captions worker: mixes the project's sound down to 16 kHz mono (with the
 * same mixer as playback and export, so what is heard is what's captioned),
 * then runs Whisper in the browser with Transformers.js. The model downloads
 * once from Hugging Face and is cached; the audio never leaves the device.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { InputAudioTrack } from 'mediabunny';
// The ONNX Runtime engine ships with the app instead of coming from a CDN at run time.
// The asyncify build holds both the processor and the WebGPU backends.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { Mixer } from '../audio/mixer';
import { streamsFrom } from '../audio/source-stream';
import { TimelineEngine } from '../engine/engine';
import { openAsset } from '../media/asset';
import { blockBoundaries, isSilent } from './blocks';
import {
  CAPTION_MODELS,
  MODEL_FILES,
  SPEECH_SAMPLE_RATE,
  type FromCaptionsWorker,
  type SpeechDevice,
  type ToCaptionsWorker,
} from './protocol';
import type { TimedText } from './segments';

env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

const send = (message: FromCaptionsWorker) => self.postMessage(message);

self.onmessage = (event: MessageEvent<ToCaptionsWorker>) => {
  run(event.data).catch((error: unknown) =>
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};

async function run({ projectJson, assets, model, language, device }: ToCaptionsWorker) {
  const engine = await TimelineEngine.fromJson(projectJson);
  const durationUs = engine.duration();
  const audio = await mixDown(engine, assets, durationUs);
  if (device === 'gpu') {
    try {
      const words = await recognise(audio, model, language, 'gpu');
      send({ type: 'done', words, durationUs, device: 'gpu' });
      return;
    } catch (error) {
      // No adapter, an unsupported card, or the device lost mid-run: the
      // processor gives the same captions, just more slowly. The client
      // restarts the run in a fresh worker (this one's runtime may be unusable).
      send({ type: 'fallback', reason: error instanceof Error ? error.message : String(error) });
      return;
    }
  }
  const words = await recognise(audio, model, language, 'cpu');
  send({ type: 'done', words, durationUs, device: 'cpu' });
}

/** Every word in `audio` (16 kHz mono) with its time in seconds. */
async function recognise(
  audio: Float32Array,
  model: ToCaptionsWorker['model'],
  language: string | null,
  device: SpeechDevice,
): Promise<TimedText[]> {
  if (device === 'gpu' && !(await hasGpuAdapter())) {
    throw new Error('This browser offers no graphics card for WebGPU.');
  }
  const { repo, revision } = CAPTION_MODELS[model];
  // Each model file reports its own progress; overall progress is bytes over all files.
  const files = new Map<string, { loaded: number; total: number }>();
  send({ type: 'progress', stage: 'model', fraction: 0 });
  const transcriber = (await pipeline('automatic-speech-recognition', repo, {
    revision,
    ...structuredClone(MODEL_FILES[device]),
    progress_callback: (info: {
      status: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (info.status !== 'progress' || !info.file || !info.total) return;
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
      const all = [...files.values()];
      const fraction = all.reduce((n, f) => n + f.loaded, 0) / all.reduce((n, f) => n + f.total, 0);
      send({ type: 'progress', stage: 'model', fraction });
    },
  } as Parameters<typeof pipeline>[2])) as AutomaticSpeechRecognitionPipeline;

  try {
    const words: TimedText[] = [];
    const cuts = blockBoundaries(audio, SPEECH_SAMPLE_RATE);
    send({ type: 'progress', stage: 'speech', fraction: 0 });
    for (let b = 0; b + 1 < cuts.length; b++) {
      const offset = cuts[b]! / SPEECH_SAMPLE_RATE;
      const block = audio.subarray(cuts[b], cuts[b + 1]);
      // Whisper invents words in silence, so silent blocks are skipped.
      if (isSilent(block)) {
        send({ type: 'progress', stage: 'speech', fraction: cuts[b + 1]! / audio.length });
        continue;
      }
      const output = await transcriber(block, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        task: 'transcribe',
        ...(language ? { language } : {}),
      });
      const result = Array.isArray(output) ? output[0]! : output;
      for (const chunk of result.chunks ?? []) {
        const [start, end] = chunk.timestamp;
        words.push({
          text: chunk.text,
          start: (start ?? 0) + offset,
          end: end === null || end === undefined ? null : end + offset,
        });
      }
      send({ type: 'progress', stage: 'speech', fraction: cuts[b + 1]! / audio.length });
    }
    return words;
  } finally {
    await transcriber.dispose().catch(() => {});
  }
}

async function hasGpuAdapter(): Promise<boolean> {
  try {
    return !!(await navigator.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

/** The project's audible sound, as Whisper wants it: 16 kHz mono. */
async function mixDown(
  engine: TimelineEngine,
  assets: ToCaptionsWorker['assets'],
  durationUs: number,
): Promise<Float32Array> {
  const tracks = new Map<string, InputAudioTrack>();
  for (const { id, file } of assets) {
    const { audio } = await openAsset(file);
    if (audio) tracks.set(id, audio);
  }
  const chunk = SPEECH_SAMPLE_RATE; // one second at a time
  const total = Math.ceil((durationUs / 1_000_000) * SPEECH_SAMPLE_RATE);
  const mono = new Float32Array(total);
  const mixer = new Mixer(streamsFrom(tracks, SPEECH_SAMPLE_RATE), SPEECH_SAMPLE_RATE, chunk);
  mixer.setSegments(engine.audioSegments().filter((s) => tracks.has(s.assetId)));
  mixer.seek(0);
  for (let at = 0; at < total; at += chunk) {
    await mixer.next();
    const n = Math.min(chunk, total - at);
    for (let i = 0; i < n; i++) mono[at + i] = (mixer.left[i]! + mixer.right[i]!) / 2;
    send({ type: 'progress', stage: 'audio', fraction: (at + n) / total });
  }
  mixer.dispose();
  return mono;
}
