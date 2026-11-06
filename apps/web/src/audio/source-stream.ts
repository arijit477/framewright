import { AudioSampleSink, type InputAudioTrack } from 'mediabunny';
import type { AudioStream } from './mixer';
import { Resampler, type Gain, type ResampleQuality } from './resampler';
import { TimeStretcher } from './time-stretch';

/** Resampled frames handed to the time stretcher at a time. */
const STRETCH_CHUNK = 2048;

/**
 * Decodes one clip's source audio sequentially from a start time, resampled to
 * `outputRate`, and time-stretched (keeping the pitch) when `speed` isn't 1.
 */
export class SourceStream implements AudioStream {
  private readonly iterator;
  private readonly resampler: Resampler;
  private readonly stretcher: TimeStretcher | null;
  private first = true;
  private ended = false;

  constructor(
    track: InputAudioTrack,
    private readonly startSeconds: number,
    outputRate: number,
    speed = 1,
    quality: ResampleQuality = 'linear',
  ) {
    this.iterator = new AudioSampleSink(track).samples(startSeconds);
    this.resampler = new Resampler(track.sampleRate / outputRate, quality);
    this.stretcher = speed === 1 ? null : new TimeStretcher(speed, outputRate);
  }

  async mixInto(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    frames: number,
    gain: Gain,
  ): Promise<void> {
    const stretcher = this.stretcher;
    if (!stretcher) {
      await this.decodeFor(frames);
      this.resampler.mixInto(left, right, offset, frames, gain);
      return;
    }
    // Feed the stretcher resampled audio until it can produce the frames asked for.
    while (stretcher.available < frames) {
      await this.decodeFor(STRETCH_CHUNK);
      const l = new Float32Array(STRETCH_CHUNK);
      const r = new Float32Array(STRETCH_CHUNK);
      this.resampler.mixInto(l, r, 0, STRETCH_CHUNK, 1); // silence once the media ends
      stretcher.push(l, r);
    }
    stretcher.mixInto(left, right, offset, frames, gain);
  }

  /** Decode until the resampler can produce `frames` frames (or the media ends). */
  private async decodeFor(frames: number): Promise<void> {
    if (this.ended) return;
    while (this.resampler.needs(frames)) {
      const { value: sample, done } = await this.iterator.next();
      if (done) {
        this.resampler.end();
        this.ended = true;
        break;
      }
      try {
        const n = sample.numberOfFrames;
        const l = new Float32Array(n);
        sample.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
        let r = l;
        if (sample.numberOfChannels > 1) {
          r = new Float32Array(n);
          sample.copyTo(r, { planeIndex: 1, format: 'f32-planar' });
        }
        this.resampler.push(l, r);
        if (this.first) {
          // The decoder starts at a packet boundary at or before the requested time.
          this.resampler.skip((this.startSeconds - sample.timestamp) * sample.sampleRate);
          this.first = false;
        }
      } finally {
        sample.close();
      }
    }
  }

  async dispose(): Promise<void> {
    await this.iterator.return();
  }
}

/** Builds a mixer stream factory over a set of decodable audio tracks. */
export const streamsFrom =
  (
    tracks: ReadonlyMap<string, InputAudioTrack>,
    outputRate: number,
    /** Playback and export use 'sinc' (what you hear is what you export); analysis may use 'linear'. */
    quality: ResampleQuality = 'linear',
  ) =>
  (assetId: string, sourceSeconds: number, speed: number): SourceStream | null => {
    const track = tracks.get(assetId);
    return track ? new SourceStream(track, sourceSeconds, outputRate, speed, quality) : null;
  };
