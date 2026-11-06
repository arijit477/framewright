import { describe, expect, it } from 'vitest';
import { cacheMatches, spriteCell, spriteSize, THUMBNAIL_CACHE_VERSION } from './cache';

describe('sprite layout', () => {
  it('lays thumbnails out in rows of 16', () => {
    expect(spriteCell(0, 128, 72)).toEqual({ x: 0, y: 0 });
    expect(spriteCell(15, 128, 72)).toEqual({ x: 15 * 128, y: 0 });
    expect(spriteCell(16, 128, 72)).toEqual({ x: 0, y: 72 });
    expect(spriteSize(3, 128, 72)).toEqual({ width: 384, height: 72 });
    expect(spriteSize(240, 128, 72)).toEqual({ width: 2048, height: 15 * 72 });
  });

  it('stays well inside image size limits for the widest, longest strips', () => {
    const { width, height } = spriteSize(240, 288, 72); // 4:1 thumbnails, the maximum count
    expect(Math.max(width, height)).toBeLessThan(16_383); // WebP's limit
  });
});

describe('cacheMatches', () => {
  const file = { size: 1000, lastModified: 42 };
  const info = {
    version: THUMBNAIL_CACHE_VERSION,
    fileSize: 1000,
    fileLastModified: 42,
    intervalUs: 1_000_000,
    count: 6,
    width: 128,
    height: 72,
  };

  it('accepts thumbnails of the same file and version', () => {
    expect(cacheMatches(info, file)).toBe(true);
  });

  it('rejects another file, another version, or a damaged entry', () => {
    expect(cacheMatches({ ...info, fileSize: 999 }, file)).toBe(false);
    expect(cacheMatches({ ...info, fileLastModified: 1 }, file)).toBe(false);
    expect(cacheMatches({ ...info, version: THUMBNAIL_CACHE_VERSION + 1 }, file)).toBe(false);
    expect(cacheMatches({ ...info, count: 0 }, file)).toBe(false);
    expect(cacheMatches({ ...info, count: 2.5 }, file)).toBe(false);
    expect(cacheMatches(null, file)).toBe(false);
    expect(cacheMatches('x', file)).toBe(false);
  });
});
