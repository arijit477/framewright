/** Anything that holds decoder resources. */
export interface Disposable {
  dispose(): Promise<void>;
}

/**
 * Decoders keyed by (asset, lane), where a lane is the track a clip sits on.
 *
 * One decoder per asset breaks down as soon as the same file is visible on two
 * tracks at once (e.g. a clip and its own B-roll copy): every frame would ask
 * it for two different times, forcing a seek each time. With a decoder per
 * lane, each one moves forward smoothly.
 *
 * Decoders are created on first use and evicted least-recently-used beyond
 * `max`, so memory stays bounded however many tracks a project has.
 */
export class ReaderPool<R extends Disposable> {
  private readonly readers = new Map<string, R>();

  constructor(
    private readonly create: (assetId: string) => R | null,
    private readonly max = 16,
  ) {}

  get(assetId: string, lane: number): R | undefined {
    const key = `${assetId}\u0000${lane}`;
    let reader = this.readers.get(key);
    if (reader) {
      // Mark as most recently used (Map keeps insertion order).
      this.readers.delete(key);
    } else {
      reader = this.create(assetId) ?? undefined;
      if (!reader) return undefined;
    }
    this.readers.set(key, reader);
    this.evict();
    return reader;
  }

  get size(): number {
    return this.readers.size;
  }

  /** Release every decoder for one asset (e.g. it was relinked). */
  async removeAsset(assetId: string): Promise<void> {
    const prefix = `${assetId}\u0000`;
    const doomed = [...this.readers].filter(([key]) => key.startsWith(prefix));
    for (const [key] of doomed) this.readers.delete(key);
    await Promise.all(doomed.map(([, reader]) => reader.dispose()));
  }

  async clear(): Promise<void> {
    const all = [...this.readers.values()];
    this.readers.clear();
    await Promise.all(all.map((reader) => reader.dispose()));
  }

  private evict() {
    while (this.readers.size > this.max) {
      const [oldestKey, oldest] = this.readers.entries().next().value!;
      this.readers.delete(oldestKey);
      void oldest.dispose();
    }
  }
}
