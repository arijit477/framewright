import type { VideoSample, VideoSampleSink } from 'mediabunny';

/**
 * Gets decoded frames for one asset, fast in both access patterns an editor has:
 *
 * - **Playback** (time moves forward a little each call): keep one decoder
 *   iterator open and pull the next samples. No seeking, no re-decoding.
 * - **Scrubbing / jumps**: restart the iterator at the new time, so the decoder
 *   seeks to the nearest keyframe once.
 *
 * The reader owns the sample it returns; callers must not close it.
 */
/** Where draw items get their pictures: video (decoded on demand) or a still. */
export interface SampleReader {
  /** The picture at `seconds` in the source, or null past the end. Owned by the reader. */
  frameAt(seconds: number): Promise<VideoSample | null>;
  dispose(): Promise<void>;
}

export class FrameReader implements SampleReader {
  /** Forward jumps larger than this restart the iterator instead of decoding through. */
  private static readonly MAX_FORWARD_DECODE_S = 1.5;

  private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private current: VideoSample | null = null;

  constructor(private readonly sink: VideoSampleSink) {}

  /** The frame on screen at `seconds` in the source, or null past the end. */
  async frameAt(seconds: number): Promise<VideoSample | null> {
    const current = this.current;
    if (current && covers(current, seconds)) return current;

    const canDecodeForward =
      this.iterator !== null &&
      current !== null &&
      seconds > current.timestamp &&
      seconds - current.timestamp < FrameReader.MAX_FORWARD_DECODE_S;

    if (!canDecodeForward) await this.restart(seconds);
    return this.advanceTo(seconds);
  }

  async dispose(): Promise<void> {
    await this.iterator?.return();
    this.iterator = null;
    this.replaceCurrent(null);
  }

  private async restart(seconds: number): Promise<void> {
    await this.iterator?.return();
    this.replaceCurrent(null);
    this.iterator = this.sink.samples(seconds);
  }

  private async advanceTo(seconds: number): Promise<VideoSample | null> {
    if (!this.iterator) return null;
    for (;;) {
      const { value, done } = await this.iterator.next();
      if (done) {
        // Past the last frame: keep showing the final one.
        this.iterator = null;
        return this.current;
      }
      this.replaceCurrent(value);
      if (value.timestamp + value.duration > seconds) return value;
    }
  }

  private replaceCurrent(sample: VideoSample | null): void {
    if (this.current && this.current !== sample) this.current.close();
    this.current = sample;
  }
}

function covers(sample: VideoSample, seconds: number): boolean {
  return sample.timestamp <= seconds && seconds < sample.timestamp + sample.duration;
}
