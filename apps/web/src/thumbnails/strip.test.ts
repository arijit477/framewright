import { describe, expect, it } from 'vitest';
import {
  generationPasses,
  indexAt,
  layoutTiles,
  MAX_THUMBNAILS,
  MIN_INTERVAL_US,
  nearestLoaded,
  planStrip,
} from './strip';

const S = 1_000_000;

describe('planStrip', () => {
  it('takes one thumbnail per second from the middle of each second', () => {
    const plan = planStrip(6 * S);
    expect(plan.intervalUs).toBe(MIN_INTERVAL_US);
    expect(plan.timesUs).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((s) => s * S));
  });

  it('caps the count for long media by widening the interval', () => {
    const plan = planStrip(3600 * S); // one hour
    expect(plan.timesUs.length).toBeLessThanOrEqual(MAX_THUMBNAILS);
    expect(plan.intervalUs).toBe(15 * S);
  });

  it('keeps every time inside the media', () => {
    const plan = planStrip(2.2 * S);
    expect(plan.timesUs).toHaveLength(3);
    expect(plan.timesUs[2]).toBe(2.1 * S); // middle of the last, shorter span (2.0-2.2 s)
  });

  it('handles empty and tiny media', () => {
    expect(planStrip(0).timesUs).toEqual([]);
    expect(planStrip(10_000).timesUs).toEqual([5000]);
  });
});

describe('generationPasses', () => {
  it('does a coarse pass first, then fills the gaps, each ascending', () => {
    expect(generationPasses(10, 4)).toEqual([
      [0, 4, 8],
      [1, 2, 3, 5, 6, 7, 9],
    ]);
  });

  it('covers every index exactly once', () => {
    const all = generationPasses(37)
      .flat()
      .sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });

  it('skips the empty second pass for short strips', () => {
    expect(generationPasses(1)).toEqual([[0]]);
  });
});

describe('lookup', () => {
  it('maps source time to a thumbnail index, clamped', () => {
    expect(indexAt(2.7 * S, S, 6)).toBe(2);
    expect(indexAt(-5, S, 6)).toBe(0);
    expect(indexAt(99 * S, S, 6)).toBe(5);
  });

  it('falls back to the nearest loaded thumbnail', () => {
    const loaded = new Set([0, 8]);
    expect(nearestLoaded(3, (i) => loaded.has(i), 10)).toBe(0);
    expect(nearestLoaded(6, (i) => loaded.has(i), 10)).toBe(8);
    expect(nearestLoaded(8, (i) => loaded.has(i), 10)).toBe(8);
    expect(nearestLoaded(4, () => false, 10)).toBe(-1);
  });
});

describe('layoutTiles', () => {
  const sourceAt = (x: number) => x * 1000; // 1 px = 1 ms

  it('tiles the clip from its left edge', () => {
    const tiles = layoutTiles({
      clipLeft: 100,
      clipRight: 300,
      tileWidth: 80,
      viewportWidth: 1000,
      sourceAt,
    });
    expect(tiles.map((t) => t.x)).toEqual([100, 180, 260]);
    expect(tiles[0]!.sourceUs).toBe(140_000); // centre of the first tile
    expect(tiles[2]!.sourceUs).toBe(300_000); // last tile's centre clamped to the clip end
  });

  it('only returns visible tiles, keeping their positions stable', () => {
    const tiles = layoutTiles({
      clipLeft: -500,
      clipRight: 2000,
      tileWidth: 100,
      viewportWidth: 250,
      sourceAt,
    });
    expect(tiles.map((t) => t.x)).toEqual([0, 100, 200]);
  });

  it('returns nothing for clips outside the viewport or degenerate input', () => {
    expect(
      layoutTiles({ clipLeft: 500, clipRight: 600, tileWidth: 50, viewportWidth: 400, sourceAt }),
    ).toEqual([]);
    expect(
      layoutTiles({ clipLeft: 0, clipRight: 100, tileWidth: 0, viewportWidth: 400, sourceAt }),
    ).toEqual([]);
  });
});
