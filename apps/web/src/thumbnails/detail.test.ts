import { describe, expect, it, vi } from 'vitest';
import { DetailCache, detailKey, detailLevel } from './detail';

describe('detailLevel', () => {
  it('keeps the base strip while at most two tiles share a picture', () => {
    expect(detailLevel(1_000_000, 1_000_000)).toBeNull();
    expect(detailLevel(500_000, 1_000_000)).toBeNull();
  });

  it('picks the coarsest level at least as fine as a tile', () => {
    expect(detailLevel(400_000, 1_000_000)).toBe(250_000);
    expect(detailLevel(140_000, 1_000_000)).toBe(125_000); // 800 px/s, 114 px tiles
    expect(detailLevel(499_999, 1_000_000)).toBe(250_000);
  });

  it('stops at the finest level', () => {
    expect(detailLevel(10_000, 1_000_000)).toBe(62_500);
  });

  it('follows the base strip spacing (long videos have sparser strips)', () => {
    expect(detailLevel(900_000, 4_000_000)).toBe(500_000);
  });
});

describe('detail keys', () => {
  it('maps a time to the middle of its slot', () => {
    expect(detailKey(0, 250_000)).toBe(125_000);
    expect(detailKey(249_999, 250_000)).toBe(125_000);
    expect(detailKey(250_000, 250_000)).toBe(375_000);
    expect(detailKey(-5, 250_000)).toBe(125_000);
  });
});

describe('DetailCache', () => {
  const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;

  it('keeps at most `max`, closing the least recently used', () => {
    const cache = new DetailCache(2);
    const [a, b, c] = [bitmap(), bitmap(), bitmap()];
    cache.set(1, a);
    cache.set(2, b);
    cache.get(1); // 1 is now the most recent
    cache.set(3, c);
    expect(cache.has(2)).toBe(false);
    expect(b.close).toHaveBeenCalled();
    expect(cache.get(1)).toBe(a);
    expect(cache.get(3)).toBe(c);
    expect(cache.size).toBe(2);
  });

  it('closes a replaced bitmap and everything on clear', () => {
    const cache = new DetailCache(4);
    const [a, b] = [bitmap(), bitmap()];
    cache.set(1, a);
    cache.set(1, b);
    expect(a.close).toHaveBeenCalled();
    cache.clear();
    expect(b.close).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});
