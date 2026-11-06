/**
 * Thumbnail cache: a finished filmstrip is saved with the project as one image
 * (a "sprite": the thumbnails in a grid, WebP) and a small description, so
 * reopening a project shows filmstrips at once instead of decoding every video
 * again. Pure parts here; the client reads and writes through `ThumbnailCache`.
 */

/** Bump when thumbnails would come out differently (size, timing, encoding). */
export const THUMBNAIL_CACHE_VERSION = 1;

/** Thumbnails per row of the sprite. */
const COLUMNS = 16;

export interface CachedStripInfo {
  version: number;
  /** The file the thumbnails were made from (a relinked file may differ). */
  fileSize: number;
  fileLastModified: number;
  intervalUs: number;
  count: number;
  width: number;
  height: number;
}

/** Where thumbnail `index` sits in the sprite. */
export function spriteCell(index: number, width: number, height: number) {
  return { x: (index % COLUMNS) * width, y: Math.floor(index / COLUMNS) * height };
}

/** The sprite's size for `count` thumbnails. */
export function spriteSize(count: number, width: number, height: number) {
  return {
    width: Math.min(count, COLUMNS) * width,
    height: Math.ceil(count / COLUMNS) * height,
  };
}

/** Whether a cached strip belongs to this file and this version of the app's thumbnails. */
export function cacheMatches(
  info: unknown,
  file: { size: number; lastModified: number },
): info is CachedStripInfo {
  if (typeof info !== 'object' || info === null) return false;
  const i = info as Record<string, unknown>;
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return (
    i.version === THUMBNAIL_CACHE_VERSION &&
    i.fileSize === file.size &&
    i.fileLastModified === file.lastModified &&
    positive(i.intervalUs) &&
    Number.isInteger(i.count) &&
    positive(i.count) &&
    positive(i.width) &&
    positive(i.height)
  );
}

/** Where thumbnails are kept (the open project's folder), or nothing. */
export interface ThumbnailCache {
  read(assetId: string): Promise<{ info: unknown; sprite: Blob } | null>;
  write(assetId: string, info: CachedStripInfo, sprite: Blob): Promise<void>;
}
