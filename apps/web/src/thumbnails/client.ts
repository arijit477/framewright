import type { FromThumbnailWorker } from './protocol';

/** Thumbnails of one asset, filled in as the worker produces them. */
export interface ThumbnailStrip {
  intervalUs: number;
  count: number;
  /** Bitmap size in device pixels. */
  width: number;
  height: number;
  bitmaps: (ImageBitmap | undefined)[];
  loaded: number;
  complete: boolean;
}

/**
 * Main-thread side of the thumbnail worker. Holds the bitmaps (they are GPU
 * resources, so they live here rather than in the React store) and closes
 * them when an asset or project goes away.
 */
export class ThumbnailClient {
  private readonly worker: Worker;
  private readonly strips = new Map<string, ThumbnailStrip>();
  /** The current job per asset; replies from older jobs are discarded. */
  private readonly jobs = new Map<string, number>();
  private nextJob = 0;
  private listener: () => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromThumbnailWorker>) => this.handle(event.data);
  }

  /** (Re)generate thumbnails for an asset. */
  request(id: string, file: Blob): void {
    this.drop(id);
    const job = ++this.nextJob;
    this.jobs.set(id, job);
    this.worker.postMessage({ type: 'generate', id, job, file });
  }

  /** Forget every asset (switching projects). */
  clear(): void {
    for (const id of [...this.strips.keys()]) this.drop(id);
    this.jobs.clear();
    this.worker.postMessage({ type: 'clear' });
  }

  strip(id: string): ThumbnailStrip | undefined {
    return this.strips.get(id);
  }

  /** Called whenever new thumbnails arrive (batched by the worker). */
  onUpdate(listener: () => void): void {
    this.listener = listener;
  }

  private drop(id: string) {
    const strip = this.strips.get(id);
    if (!strip) return;
    for (const bitmap of strip.bitmaps) bitmap?.close();
    this.strips.delete(id);
  }

  private handle(message: FromThumbnailWorker) {
    if (this.jobs.get(message.id) !== message.job) {
      // A reply to a replaced or cleared request.
      if (message.type === 'thumbs') for (const { bitmap } of message.items) bitmap.close();
      return;
    }
    switch (message.type) {
      case 'plan':
        this.drop(message.id);
        this.strips.set(message.id, {
          intervalUs: message.intervalUs,
          count: message.count,
          width: message.width,
          height: message.height,
          bitmaps: new Array<ImageBitmap | undefined>(message.count),
          loaded: 0,
          complete: false,
        });
        break;
      case 'thumbs': {
        const strip = this.strips.get(message.id);
        for (const { index, bitmap } of message.items) {
          if (!strip || index >= strip.count || strip.bitmaps[index]) {
            bitmap.close();
            continue;
          }
          strip.bitmaps[index] = bitmap;
          strip.loaded++;
        }
        this.listener();
        break;
      }
      case 'done': {
        const strip = this.strips.get(message.id);
        if (strip) strip.complete = true;
        this.listener();
        break;
      }
      case 'error':
        // Thumbnails are cosmetic: the clip still plays; log for diagnosis.
        console.warn(`[thumbnails] ${message.id}: ${message.message}`);
        break;
    }
  }
}
