/**
 * Finer thumbnails when zoomed in. The base filmstrip has at most one
 * thumbnail a second (`planStrip`); zoomed far in, one tile covers a fraction
 * of that and neighbouring tiles would repeat the same picture. Detail levels
 * fill in: thumbnails at finer, fixed spacings, made on demand for the part of
 * a clip on screen only, and kept in a bounded cache.
 */

/** Spacings of the detail levels, coarsest first (µs). */
export const DETAIL_LEVELS_US = [500_000, 250_000, 125_000, 62_500] as const;

/** Detail thumbnails kept per asset at most (128×72×4 B each: about 9 MB at 240). */
export const MAX_DETAIL_THUMBNAILS = 240;

/**
 * The detail spacing for tiles `tileUs` long, or null if the base strip
 * (one thumbnail every `baseIntervalUs`) is fine enough: at most two tiles
 * share a picture. The finest level is used when even it is coarser.
 */
export function detailLevel(tileUs: number, baseIntervalUs: number): number | null {
  if (tileUs * 2 >= baseIntervalUs) return null;
  const level = DETAIL_LEVELS_US.find((spacing) => spacing <= tileUs);
  return level ?? DETAIL_LEVELS_US[DETAIL_LEVELS_US.length - 1]!;
}

/** The detail time (µs) a tile at `sourceUs` shows: the middle of its spacing slot. */
export const detailKey = (sourceUs: number, spacingUs: number): number =>
  Math.floor(Math.max(0, sourceUs) / spacingUs) * spacingUs + Math.floor(spacingUs / 2);

/** One number for a (level, time) pair: levels can share times. */
export const detailId = (spacingUs: number, keyUs: number): number =>
  keyUs * DETAIL_LEVELS_US.length + DETAIL_LEVELS_US.indexOf(spacingUs as never);

/** Bitmaps by key, dropping (and closing) the least recently used beyond `max`. */
export class DetailCache {
  private readonly items = new Map<number, ImageBitmap>();

  constructor(private readonly max = MAX_DETAIL_THUMBNAILS) {}

  get(key: number): ImageBitmap | undefined {
    const bitmap = this.items.get(key);
    if (bitmap) {
      // Most recently used last.
      this.items.delete(key);
      this.items.set(key, bitmap);
    }
    return bitmap;
  }

  has(key: number): boolean {
    return this.items.has(key);
  }

  set(key: number, bitmap: ImageBitmap): void {
    this.items.get(key)?.close();
    this.items.delete(key);
    this.items.set(key, bitmap);
    while (this.items.size > this.max) {
      const [oldest, old] = this.items.entries().next().value!;
      old.close();
      this.items.delete(oldest);
    }
  }

  clear(): void {
    for (const bitmap of this.items.values()) bitmap.close();
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}
