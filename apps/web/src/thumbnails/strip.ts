/**
 * Filmstrip maths: which source times get a thumbnail, in what order they are
 * generated, and which thumbnail each tile on the timeline shows. Pure and
 * unit-tested; the worker and the canvas timeline only call into it.
 */

/** Thumbnail size in device pixels (the timeline scales them to the track height). */
export const THUMB_HEIGHT = 72;
/** Never sample more often than this... */
export const MIN_INTERVAL_US = 1_000_000;
/** ...nor store more than this many per asset (memory: 240 × 128×72×4 B ≈ 8.8 MB). */
export const MAX_THUMBNAILS = 240;
/** The first pass takes every Nth thumbnail so the whole strip appears quickly. */
export const COARSE_STRIDE = 8;

export interface StripPlan {
  intervalUs: number;
  /** Source time of each thumbnail, in microseconds (index order). */
  timesUs: number[];
}

/** Evenly spaced thumbnails, each taken from the middle of the span it represents. */
export function planStrip(durationUs: number): StripPlan {
  if (durationUs <= 0) return { intervalUs: MIN_INTERVAL_US, timesUs: [] };
  const intervalUs = Math.max(MIN_INTERVAL_US, Math.ceil(durationUs / MAX_THUMBNAILS));
  const count = Math.max(1, Math.ceil(durationUs / intervalUs));
  // The middle of the span each thumbnail covers (the last span may be shorter).
  const timesUs = Array.from({ length: count }, (_, i) => {
    const start = i * intervalUs;
    const end = Math.min(durationUs, start + intervalUs);
    return Math.round((start + end) / 2);
  });
  return { intervalUs, timesUs };
}

/**
 * Generation order: a coarse pass (every `stride`th index), then the rest.
 * Each pass is ascending, so the decoder only ever moves forward within it.
 */
export function generationPasses(count: number, stride = COARSE_STRIDE): number[][] {
  const coarse: number[] = [];
  const fine: number[] = [];
  for (let i = 0; i < count; i++) (i % stride === 0 ? coarse : fine).push(i);
  return fine.length > 0 ? [coarse, fine] : [coarse];
}

/** The thumbnail index for a source time. */
export function indexAt(sourceUs: number, intervalUs: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(sourceUs / intervalUs)));
}

/** The closest index whose thumbnail has loaded, searching outwards, or -1. */
export function nearestLoaded(index: number, isLoaded: (i: number) => boolean, count: number) {
  for (let d = 0; d < count; d++) {
    if (index - d >= 0 && isLoaded(index - d)) return index - d;
    if (index + d < count && isLoaded(index + d)) return index + d;
  }
  return -1;
}

export interface Tile {
  /** Left edge in CSS pixels. */
  x: number;
  /** Source time shown by this tile (its centre). */
  sourceUs: number;
}

/**
 * Tiles of `tileWidth` px laid from the clip's left edge, so thumbnails stay
 * put relative to the clip while scrolling. Only tiles overlapping the
 * visible range [0, viewportWidth) are returned.
 */
export function layoutTiles(options: {
  clipLeft: number;
  clipRight: number;
  tileWidth: number;
  viewportWidth: number;
  /** Source time at a given x (CSS px). */
  sourceAt: (x: number) => number;
}): Tile[] {
  const { clipLeft, clipRight, tileWidth, viewportWidth, sourceAt } = options;
  if (tileWidth <= 0 || clipRight <= clipLeft) return [];
  const from = Math.max(clipLeft, 0);
  const to = Math.min(clipRight, viewportWidth);
  if (to <= from) return [];
  const first = Math.floor((from - clipLeft) / tileWidth);
  const tiles: Tile[] = [];
  for (let x = clipLeft + first * tileWidth; x < to; x += tileWidth) {
    const centre = Math.min(x + tileWidth / 2, clipRight);
    tiles.push({ x, sourceUs: sourceAt(centre) });
  }
  return tiles;
}
