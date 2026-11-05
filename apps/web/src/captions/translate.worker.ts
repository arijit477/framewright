/**
 * Translation worker: runs each caption through the OPUS-MT models on a route
 * (one, or two through English), on the device. One worker per run.
 */
import { pipeline, type TranslationPipeline } from '@huggingface/transformers';
import { downloadProgress } from './onnx-env';
import {
  oneLine,
  pairRepo,
  TRANSLATION_PAIRS,
  type FromTranslationWorker,
  type ToTranslationWorker,
} from './translation';

/**
 * Sentences translated together. Measured on a 5.5-minute video (61 captions,
 * `e2e/translation-bench.spec.ts`, model cached): 4 → 19 s, 8 → 11.6–12 s,
 * 16 → 9–10.5 s, 32 → 9.5 s.
 */
const BATCH = 16;

const send = (message: FromTranslationWorker) => self.postMessage(message);

self.onmessage = (event: MessageEvent<ToTranslationWorker>) => {
  run(event.data).catch((error: unknown) =>
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};

async function run({ texts, route }: ToTranslationWorker) {
  let current = texts.map(oneLine);
  for (const [index, pair] of route.entries()) {
    const step = index + 1;
    const steps = route.length;
    send({ type: 'progress', stage: 'model', fraction: 0, step, steps });
    const translator = (await pipeline('translation', pairRepo(pair), {
      revision: TRANSLATION_PAIRS[pair]!.revision,
      dtype: 'q8',
      device: 'wasm',
      progress_callback: downloadProgress((fraction) =>
        send({ type: 'progress', stage: 'model', fraction, step, steps }),
      ),
    })) as TranslationPipeline;
    try {
      const next: string[] = [];
      for (let i = 0; i < current.length; i += BATCH) {
        // Multi-target models (en-ar, en-zh, en-vi) document a `>>lang<<` prefix, but
        // Transformers.js tokenises it as text and it leaks into the output; without
        // it they write Modern Standard Arabic, simplified Chinese and Vietnamese.
        const batch = current.slice(i, i + BATCH);
        const output = (await translator(batch, { max_new_tokens: 256 })) as {
          translation_text: string;
        }[];
        next.push(...output.map((o) => oneLine(o.translation_text)));
        send({
          type: 'progress',
          stage: 'translate',
          fraction: Math.min(1, (i + BATCH) / current.length),
          step,
          steps,
        });
      }
      current = next;
    } finally {
      await translator.dispose().catch(() => {});
    }
  }
  send({ type: 'done', texts: current });
}
