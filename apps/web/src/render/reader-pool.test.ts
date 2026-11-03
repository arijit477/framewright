import { describe, expect, it } from 'vitest';
import { ReaderPool } from './reader-pool';

class FakeReader {
  disposed = false;
  constructor(readonly assetId: string) {}
  async dispose() {
    this.disposed = true;
  }
}

const pool = (max?: number) => {
  const created: FakeReader[] = [];
  const p = new ReaderPool((assetId) => {
    if (assetId === 'audio-only') return null;
    const reader = new FakeReader(assetId);
    created.push(reader);
    return reader;
  }, max);
  return { p, created };
};

describe('ReaderPool', () => {
  it('gives each (asset, lane) its own decoder and reuses it', () => {
    const { p, created } = pool();
    const a0 = p.get('a', 0);
    const a1 = p.get('a', 1);
    expect(a0).not.toBe(a1); // same file on two tracks: two decoders
    expect(p.get('a', 0)).toBe(a0);
    expect(created).toHaveLength(2);
  });

  it('returns undefined for assets without video', () => {
    const { p } = pool();
    expect(p.get('audio-only', 0)).toBeUndefined();
    expect(p.size).toBe(0);
  });

  it('evicts the least recently used decoder beyond the limit', () => {
    const { p, created } = pool(2);
    p.get('a', 0);
    p.get('b', 0);
    p.get('a', 0); // a is now most recent
    p.get('c', 0); // evicts b
    expect(created.find((r) => r.assetId === 'b')!.disposed).toBe(true);
    expect(created.find((r) => r.assetId === 'a')!.disposed).toBe(false);
    expect(p.size).toBe(2);
  });

  it('releases every lane of an asset', async () => {
    const { p, created } = pool();
    p.get('a', 0);
    p.get('a', 3);
    p.get('b', 0);
    await p.removeAsset('a');
    expect(created.filter((r) => r.disposed).map((r) => r.assetId)).toEqual(['a', 'a']);
    expect(p.size).toBe(1);
  });

  it('does not confuse asset ids that are prefixes of each other', async () => {
    const { p } = pool();
    p.get('a', 1);
    p.get('a1', 0);
    await p.removeAsset('a');
    expect(p.size).toBe(1);
  });

  it('clears everything', async () => {
    const { p, created } = pool();
    p.get('a', 0);
    p.get('b', 1);
    await p.clear();
    expect(created.every((r) => r.disposed)).toBe(true);
    expect(p.size).toBe(0);
  });
});
