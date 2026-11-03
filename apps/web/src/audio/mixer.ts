import type { AudioSegment } from '../engine/types';

/** A decoded, resampled audio source for one clip, read sequentially. */
export interface AudioStream {
  /** Add `frames` frames times `gain` into the buffers at `offset`, advancing the stream. */
  mixInto(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    frames: number,
    gain: number,
  ): Promise<void>;
  dispose(): Promise<void>;
}

/** Opens a stream for an asset starting at a source time, or null if it has no audio. */
export type StreamFactory = (assetId: string, sourceSeconds: number) => AudioStream | null;

/**
 * Mixes the timeline's audio, one fixed-size chunk at a time. Used both for
 * real-time playback (audio worker) and offline export (export worker), so
 * what you hear is exactly what you export.
 *
 * Timing is kept as an integer frame count since the last `seek`, and every
 * segment edge is converted to a frame index the same way, so adjacent
 * segments (e.g. the two halves of a split clip) meet with no gap or overlap,
 * and long renders don't drift.
 */
export class Mixer {
  readonly left: Float32Array;
  readonly right: Float32Array;
  private segments: AudioSegment[] = [];
  private readonly streams = new Map<number, AudioStream>();
  private seekUs = 0;
  private framesSinceSeek = 0;
  /** Bumped by `seek`, so an in-flight `next()` knows its result is stale. */
  private generation = 0;

  constructor(
    private readonly openStream: StreamFactory,
    readonly sampleRate: number,
    readonly chunkFrames: number,
  ) {
    this.left = new Float32Array(chunkFrames);
    this.right = new Float32Array(chunkFrames);
  }

  /** Timeline time of the next frame `next()` will produce. */
  get positionUs(): number {
    return this.seekUs + (this.framesSinceSeek * 1_000_000) / this.sampleRate;
  }

  /** Replace the audible segments. Call `seek` afterwards to apply them from a point in time. */
  setSegments(segments: AudioSegment[]): void {
    this.segments = segments;
  }

  /** Restart mixing at `timeUs`. Releases all decoders. */
  seek(timeUs: number): void {
    this.generation++;
    this.seekUs = timeUs;
    this.framesSinceSeek = 0;
    this.disposeStreams();
  }

  /**
   * Mix the next chunk into `left`/`right` and advance. Returns false (and does
   * not advance) if `seek` was called while it was decoding.
   */
  async next(): Promise<boolean> {
    const generation = this.generation;
    this.left.fill(0);
    this.right.fill(0);
    const chunkStart = this.framesSinceSeek;
    const chunkEnd = chunkStart + this.chunkFrames;
    const active = new Set<number>();

    for (const segment of this.segments) {
      const segmentStart = this.toFrame(segment.start);
      const segmentEnd = this.toFrame(segment.start + segment.duration);
      const from = Math.max(chunkStart, segmentStart);
      const to = Math.min(chunkEnd, segmentEnd);
      if (from >= to) continue;
      active.add(segment.clipId);

      let stream = this.streams.get(segment.clipId);
      if (!stream) {
        const timelineUs = this.seekUs + (from * 1_000_000) / this.sampleRate;
        const sourceSeconds = (segment.sourceIn + (timelineUs - segment.start)) / 1_000_000;
        const opened = this.openStream(segment.assetId, Math.max(0, sourceSeconds));
        if (!opened) continue;
        stream = opened;
        // Registered before awaiting, so a concurrent seek() disposes it too.
        this.streams.set(segment.clipId, stream);
      }
      await stream.mixInto(this.left, this.right, from - chunkStart, to - from, segment.gain);
      if (generation !== this.generation) return false;
    }

    // Release decoders of clips that are no longer audible.
    for (const [clipId, stream] of this.streams) {
      if (!active.has(clipId)) {
        void stream.dispose();
        this.streams.delete(clipId);
      }
    }
    this.framesSinceSeek = chunkEnd;
    return true;
  }

  dispose(): void {
    this.generation++;
    this.disposeStreams();
  }

  /** Timeline time to a frame index relative to the last seek. */
  private toFrame(timeUs: number): number {
    return Math.round(((timeUs - this.seekUs) * this.sampleRate) / 1_000_000);
  }

  private disposeStreams(): void {
    for (const stream of this.streams.values()) void stream.dispose();
    this.streams.clear();
  }
}
