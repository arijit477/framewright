import { AudioSampleSink, type InputAudioTrack } from 'mediabunny';
import type { AudioStream } from './mixer';
import { Resampler, type Gain } from './resampler';

/** Decodes one clip's source audio sequentially from a start time, resampled to `outputRate`. */
export class SourceStream implements AudioStream {
  private readonly iterator;
  private readonly resampler: Resampler;
  private first = true;

  constructor(
    track: InputAudioTrack,
    private readonly startSeconds: number,
    outputRate: number,
  ) {
    this.iterator = new AudioSampleSink(track).samples(startSeconds);
    this.resampler = new Resampler(track.sampleRate / outputRate);
  }

  async mixInto(
    left: Float32Array,
    right: Float32Array,
    offset: number,
    frames: number,
    gain: Gain,
  ): Promise<void> {
    while (this.resampler.needs(frames)) {
      const { value: sample, done } = await this.iterator.next();
      if (done) {
        this.resampler.end();
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
    this.resampler.mixInto(left, right, offset, frames, gain);
  }

  async dispose(): Promise<void> {
    await this.iterator.return();
  }
}

/** Builds a mixer stream factory over a set of decodable audio tracks. */
export const streamsFrom =
  (tracks: ReadonlyMap<string, InputAudioTrack>, outputRate: number) =>
  (assetId: string, sourceSeconds: number): SourceStream | null => {
    const track = tracks.get(assetId);
    return track ? new SourceStream(track, sourceSeconds, outputRate) : null;
  };
