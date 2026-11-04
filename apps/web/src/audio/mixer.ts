import type { AudioSegment } from '../engine/types';
import { fadesOverlap, segmentFade } from './fade';
import type { Gain } from './resampler';

/** A decoded, resampled audio source for one clip, read sequentially. */
export interface AudioStream {
  /**
   * Add `frames` frames times `gain` into the buffers at `offset`, advancing
   * the stream. A per-frame `gain` array is indexed from 0 (frame `offset`).
   */
  mixInto(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    frames: number,
    gain: Gain,
  ): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Opens a stream for an asset starting at a source time, playing at `speed`
 * (1 = normal; pitch is preserved), or null if it has no audio.
 */
export type StreamFactory = (
  assetId: string,
  sourceSeconds: number,
  speed: number,
) => AudioStream | null;

/**
 * Mixes the timeline's audio, one fixed-size chunk at a time. Used both for
 * real-time playback (audio worker) and offline export (export worker), so
 * what you hear is exactly what you export.
 *
 * Timing is kept as an integer frame count since the last `seek`, and every
 * segment edge is converted to a frame index the same way, so adjacent
 * segments (e.g. the two halves of a split clip) meet with no gap or overlap,
 * and long renders don't drift.
 *
 * Fades (under video transitions) are applied per frame here, so playback and
 * export get the same crossfades.
 */
export class Mixer {
  readonly left: Float32Array;
  readonly right: Float32Array;
  /** Scratch per-frame gains for segments that are fading in this chunk. */
  private readonly gains: Float32Array;
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
    this.gains = new Float32Array(chunkFrames);
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
        const sourceUs = segment.sourceIn + (timelineUs - segment.start) * segment.speed;
        const opened = this.openStream(
          segment.assetId,
          Math.max(0, sourceUs / 1_000_000),
          segment.speed,
        );
        if (!opened) continue;
        stream = opened;
        // Registered before awaiting, so a concurrent seek() disposes it too.
        this.streams.set(segment.clipId, stream);
      }
      const gain = this.gainFor(segment, from, to);
      await stream.mixInto(this.left, this.right, from - chunkStart, to - from, gain);
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

  /**
   * The segment's gain over frames [from, to): a single value unless a fade
   * runs through them. The array is reused; that is safe because `next()`
   * awaits each stream's `mixInto` before computing the next gains.
   */
  private gainFor(segment: AudioSegment, from: number, to: number): Gain {
    const fromUs = this.toTime(from);
    const toUs = this.toTime(to);
    if (!fadesOverlap(segment, fromUs, toUs)) {
      return segment.gain * segmentFade(segment, (fromUs + toUs) / 2);
    }
    const gains = this.gains.subarray(0, to - from);
    for (let i = 0; i < gains.length; i++) {
      gains[i] = segment.gain * segmentFade(segment, this.toTime(from + i));
    }
    return gains;
  }

  /** A frame index relative to the last seek to timeline time. */
  private toTime(frame: number): number {
    return this.seekUs + (frame * 1_000_000) / this.sampleRate;
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
