import {
  cacheMatches,
  spriteCell,
  spriteSize,
  THUMBNAIL_CACHE_VERSION,
  type CachedStripInfo,
  type ThumbnailCache,
} from './cache';
import { DetailCache, detailId } from './detail';
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
  /** Where finished strips are kept (the open project), or null. */
  private cache: ThumbnailCache | null = null;
  /** The file of each strip being generated, to describe it when it's cached. */
  private readonly generating = new Map<string, { file: Blob; cache: ThumbnailCache }>();
  /** Each asset's file, for detail requests. */
  private readonly files = new Map<string, Blob>();
  /** Finer thumbnails (zoomed in), per asset; see detail.ts. */
  private readonly details = new Map<string, DetailCache>();
  /** Detail thumbnails asked for and not yet arrived, per asset (the latest request only). */
  private readonly pendingDetail = new Map<string, Set<number>>();

  constructor() {
    this.worker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromThumbnailWorker>) => this.handle(event.data);
  }

  /** Keep finished strips here, and look for them before generating (null: don't). */
  setCache(cache: ThumbnailCache | null): void {
    this.cache = cache;
  }

  /** A finer thumbnail, if it has arrived. */
  detail(id: string, spacingUs: number, keyUs: number): ImageBitmap | undefined {
    return this.details.get(id)?.get(detailId(spacingUs, keyUs));
  }

  /**
   * Ask for finer thumbnails at these source times (the visible part of a clip,
   * zoomed in). Times already here or on their way are skipped; a newer request
   * replaces an older one the worker hasn't started.
   */
  requestDetail(id: string, spacingUs: number, keysUs: readonly number[]): void {
    const file = this.files.get(id);
    const strip = this.strips.get(id);
    if (!file || !strip) return;
    const cache = this.details.get(id);
    const pending = this.pendingDetail.get(id);
    const missing = keysUs.filter((key) => {
      const did = detailId(spacingUs, key);
      return !cache?.has(did) && !pending?.has(did);
    });
    if (missing.length === 0) return;
    this.pendingDetail.set(id, new Set(missing.map((key) => detailId(spacingUs, key))));
    this.worker.postMessage({
      type: 'detail',
      id,
      job: this.jobs.get(id) ?? 0,
      file,
      spacingUs,
      timesUs: missing,
      width: strip.width,
      height: strip.height,
    });
  }

  /** Thumbnails for an asset: from the cache if it has this file's, otherwise generated. */
  request(id: string, file: Blob): void {
    this.drop(id);
    this.generating.delete(id);
    this.files.set(id, file);
    const job = ++this.nextJob;
    this.jobs.set(id, job);
    void this.start(id, job, file);
  }

  private async start(id: string, job: number, file: Blob) {
    const cache = this.cache;
    if (cache) {
      const hit = await cache.read(id).catch(() => null);
      if (this.jobs.get(id) !== job) return; // replaced or cleared meanwhile
      if (hit && cacheMatches(hit.info, fileStamp(file))) {
        if (await this.fromSprite(id, job, hit.info, hit.sprite)) return;
      }
      this.generating.set(id, { file, cache });
    }
    this.worker.postMessage({ type: 'generate', id, job, file });
  }

  /** Show a cached strip: each thumbnail cut from the sprite. False if it can't be read. */
  private async fromSprite(id: string, job: number, info: CachedStripInfo, sprite: Blob) {
    try {
      const bitmaps = await Promise.all(
        Array.from({ length: info.count }, (_, i) => {
          const { x, y } = spriteCell(i, info.width, info.height);
          return createImageBitmap(sprite, x, y, info.width, info.height);
        }),
      );
      if (this.jobs.get(id) !== job) {
        for (const bitmap of bitmaps) bitmap.close();
        return true; // superseded: nothing more to do for this job
      }
      this.strips.set(id, {
        intervalUs: info.intervalUs,
        count: info.count,
        width: info.width,
        height: info.height,
        bitmaps,
        loaded: info.count,
        complete: true,
      });
      this.listener();
      return true;
    } catch {
      return false;
    }
  }

  /** Save a finished strip as one WebP sprite (best effort: thumbnails are cosmetic). */
  private async save(id: string, strip: ThumbnailStrip) {
    const pending = this.generating.get(id);
    this.generating.delete(id);
    if (!pending || strip.loaded !== strip.count) return;
    try {
      const size = spriteSize(strip.count, strip.width, strip.height);
      const canvas = new OffscreenCanvas(size.width, size.height);
      const ctx = canvas.getContext('2d')!;
      strip.bitmaps.forEach((bitmap, i) => {
        const { x, y } = spriteCell(i, strip.width, strip.height);
        if (bitmap) ctx.drawImage(bitmap, x, y, strip.width, strip.height);
      });
      const sprite = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
      const { size: fileSize, lastModified: fileLastModified } = fileStamp(pending.file);
      await pending.cache.write(
        id,
        {
          version: THUMBNAIL_CACHE_VERSION,
          fileSize,
          fileLastModified,
          intervalUs: strip.intervalUs,
          count: strip.count,
          width: strip.width,
          height: strip.height,
        },
        sprite,
      );
    } catch (error) {
      console.warn(`[thumbnails] ${id}: not cached`, error);
    }
  }

  /** Forget every asset (switching projects). */
  clear(): void {
    for (const id of [...this.strips.keys()]) this.drop(id);
    this.jobs.clear();
    this.generating.clear();
    this.files.clear();
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
    this.details.get(id)?.clear();
    this.details.delete(id);
    this.pendingDetail.delete(id);
    const strip = this.strips.get(id);
    if (!strip) return;
    for (const bitmap of strip.bitmaps) bitmap?.close();
    this.strips.delete(id);
  }

  private handle(message: FromThumbnailWorker) {
    if (this.jobs.get(message.id) !== message.job) {
      // A reply to a replaced or cleared request.
      if (message.type === 'thumbs' || message.type === 'detailThumbs') {
        for (const { bitmap } of message.items) bitmap.close();
      }
      return;
    }
    if (message.type === 'detailThumbs') {
      const spacing = message.spacingUs;
      if (!this.strips.has(message.id)) {
        for (const { bitmap } of message.items) bitmap.close();
        return;
      }
      let cache = this.details.get(message.id);
      if (!cache) this.details.set(message.id, (cache = new DetailCache()));
      for (const { timeUs, bitmap } of message.items) {
        const did = detailId(spacing, timeUs);
        cache.set(did, bitmap);
        this.pendingDetail.get(message.id)?.delete(did);
      }
      this.listener();
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
        if (strip) {
          strip.complete = true;
          void this.save(message.id, strip);
        }
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

/** What identifies the file a strip was made from (a Blob has no date: 0). */
const fileStamp = (file: Blob) => ({
  size: file.size,
  lastModified: file instanceof File ? file.lastModified : 0,
});
