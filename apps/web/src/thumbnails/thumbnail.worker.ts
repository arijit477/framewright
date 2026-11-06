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
import { STILL_DURATION_US } from '../media/still';
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

interface DetailJob extends Job {
  spacingUs: number;
  timesUs: number[];
  width: number;
  height: number;
}
/** Detail requests go first (the user is looking at them), one per asset at a time. */
const details: DetailJob[] = [];

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'clear') {
    for (const job of [...queue, ...details]) job.cancelled = true;
    queue.length = 0;
    details.length = 0;
    if (running) running.cancelled = true;
    return;
  }
  if (message.type === 'detail') {
    // The view moved: an older, unstarted request for this asset is no longer wanted.
    for (const job of details) if (job.id === message.id) job.cancelled = true;
    details.push({ ...message, cancelled: false });
    void drain();
    return;
  }
  // A new request for the same asset (e.g. relinked) replaces any older one.
  for (const job of [...queue, running]) if (job?.id === message.id) job.cancelled = true;
  queue.push({ id: message.id, job: message.job, file: message.file, cancelled: false });
  void drain();
};

async function drain() {
  if (running) return;
  while (queue.length > 0 || details.length > 0) {
    const job = details.shift() ?? queue.shift()!;
    if (job.cancelled) continue;
    running = job;
    try {
      await ('timesUs' in job ? detail(job as DetailJob) : generate(job));
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
  const { video, still } = await openAsset(job.file);
  if (still) return stillThumbnail(job, still);
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

/** A still image: one thumbnail, shown along the whole clip. */
async function stillThumbnail(job: Job, still: ImageBitmap) {
  try {
    if (job.cancelled) return;
    const height = THUMB_HEIGHT;
    const aspect = still.height > 0 ? still.width / still.height : 16 / 9;
    const width = Math.max(2, Math.round((height * Math.min(4, Math.max(0.25, aspect))) / 2) * 2);
    send({
      type: 'plan',
      id: job.id,
      job: job.job,
      intervalUs: STILL_DURATION_US,
      count: 1,
      width,
      height,
    });
    const bitmap = await createImageBitmap(still, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'medium',
    });
    send({ type: 'thumbs', id: job.id, job: job.job, items: [{ index: 0, bitmap }] }, [bitmap]);
    send({ type: 'done', id: job.id, job: job.job });
  } finally {
    still.close();
  }
}

/** Thumbnails at the requested source times (zoomed in), sent as they're made. */
async function detail(job: DetailJob) {
  const { video, still } = await openAsset(job.file);
  still?.close(); // a still's base strip already shows it at every zoom
  if (!video || job.cancelled) return;
  const sink = new CanvasSink(video, { width: job.width, height: job.height, fit: 'cover' });
  let items: { timeUs: number; bitmap: ImageBitmap }[] = [];
  const flush = () => {
    if (items.length === 0) return;
    send(
      { type: 'detailThumbs', id: job.id, job: job.job, spacingUs: job.spacingUs, items },
      items.map((i) => i.bitmap),
    );
    items = [];
  };
  let n = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(job.timesUs.map((t) => t / 1_000_000))) {
    const timeUs = job.timesUs[n++]!;
    if (job.cancelled) break;
    if (!wrapped) continue;
    items.push({ timeUs, bitmap: await createImageBitmap(wrapped.canvas) });
    if (items.length >= BATCH_SIZE) flush();
  }
  if (!job.cancelled) flush();
  else for (const item of items) item.bitmap.close();
}
