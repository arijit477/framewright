/**
 * Thumbnail worker: decodes small frames for the timeline filmstrip with its
 * own decoders, so it never competes with the preview's.
 *
 * Assets are processed one at a time (bounded CPU and memory). Thumbnails are
 * posted in small batches so the strip fills in progressively: a coarse pass
 * first, then the gaps (see strip.ts).
 */
import { CanvasSink } from 'mediabunny';
import { openAsset } from '../media/asset';
import type { FromThumbnailWorker, ToThumbnailWorker } from './protocol';
import { generationPasses, planStrip, THUMB_HEIGHT } from './strip';

const BATCH_MS = 150;
const BATCH_SIZE = 16;

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToThumbnailWorker>) => void) | null;
  postMessage(message: FromThumbnailWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
const send = (message: FromThumbnailWorker, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

interface Job {
  id: string;
  job: number;
  file: Blob;
  cancelled: boolean;
}

const queue: Job[] = [];
let running: Job | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'clear') {
    for (const job of queue) job.cancelled = true;
    queue.length = 0;
    if (running) running.cancelled = true;
    return;
  }
  // A new request for the same asset (e.g. relinked) replaces any older one.
  for (const job of [...queue, running]) if (job?.id === message.id) job.cancelled = true;
  queue.push({ id: message.id, job: message.job, file: message.file, cancelled: false });
  void drain();
};

async function drain() {
  if (running) return;
  while (queue.length > 0) {
    const job = queue.shift()!;
    if (job.cancelled) continue;
    running = job;
    try {
      await generate(job);
    } catch (error) {
      if (!job.cancelled) {
        send({
          type: 'error',
          id: job.id,
          job: job.job,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      running = null;
    }
  }
}

async function generate(job: Job) {
  const { video } = await openAsset(job.file);
  if (!video || job.cancelled) return;
  const durationUs = Math.round((await video.computeDuration()) * 1_000_000);
  const plan = planStrip(durationUs);
  const height = THUMB_HEIGHT;
  // Even width keeps scaling crisp; guard against bogus metadata.
  const aspect = video.displayHeight > 0 ? video.displayWidth / video.displayHeight : 16 / 9;
  const width = Math.max(2, Math.round((height * Math.min(4, Math.max(0.25, aspect))) / 2) * 2);
  send({
    type: 'plan',
    id: job.id,
    job: job.job,
    intervalUs: plan.intervalUs,
    count: plan.timesUs.length,
    width,
    height,
  });

  const sink = new CanvasSink(video, { width, height, fit: 'cover' });
  let batch: { index: number; bitmap: ImageBitmap }[] = [];
  let lastFlush = performance.now();
  const flush = () => {
    if (batch.length === 0) return;
    send(
      { type: 'thumbs', id: job.id, job: job.job, items: batch },
      batch.map((t) => t.bitmap),
    );
    batch = [];
    lastFlush = performance.now();
  };

  for (const pass of generationPasses(plan.timesUs.length)) {
    const timestamps = pass.map((i) => plan.timesUs[i]! / 1_000_000);
    let n = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      const index = pass[n++]!;
      if (job.cancelled) {
        for (const t of batch) t.bitmap.close();
        return;
      }
      if (!wrapped) continue; // no frame there (e.g. a gap): the timeline uses a neighbour
      batch.push({ index, bitmap: await createImageBitmap(wrapped.canvas) });
      if (batch.length >= BATCH_SIZE || performance.now() - lastFlush > BATCH_MS) flush();
    }
    flush();
  }
  send({ type: 'done', id: job.id, job: job.job });
}
