import { describe, expect, it } from 'vitest';
import type { AudioSegment } from '../engine/types';
import { Mixer, type AudioStream } from './mixer';

const RATE = 1000; // 1 frame = 1 ms, so the maths is easy to read
const ms = (n: number) => n * 1000; // ms -> µs

/** A fake source that outputs a constant value and records where it was opened. */
class ConstantStream implements AudioStream {
  disposed = false;
  constructor(
    readonly value: number,
    readonly startSeconds: number,
  ) {}
  async mixInto(l: Float32Array, r: Float32Array, offset: number, frames: number, gain: number) {
    for (let i = 0; i < frames; i++) {
      l[offset + i]! += this.value * gain;
      r[offset + i]! += this.value * gain;
    }
  }
  async dispose() {
    this.disposed = true;
  }
}

function setup(segments: AudioSegment[], values: Record<string, number> = { a: 1, b: 1 }) {
  const opened: ConstantStream[] = [];
  const mixer = new Mixer(
    (assetId, startSeconds) => {
      const value = values[assetId];
      if (value === undefined) return null;
      const stream = new ConstantStream(value, startSeconds);
      opened.push(stream);
      return stream;
    },
    RATE,
    10,
  );
  mixer.setSegments(segments);
  mixer.seek(0);
  return { mixer, opened };
}

const segment = (s: Partial<AudioSegment> & Pick<AudioSegment, 'clipId'>): AudioSegment => ({
  assetId: 'a',
  start: 0,
  duration: ms(10),
  sourceIn: 0,
  gain: 1,
  ...s,
});

describe('Mixer', () => {
  it('places a segment at the right offset within a chunk', async () => {
    const { mixer } = setup([segment({ clipId: 1, start: ms(3), duration: ms(4) })]);
    await mixer.next();
    expect([...mixer.left]).toEqual([0, 0, 0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('joins adjacent segments with no gap or overlap', async () => {
    // Two halves of a split clip meeting at 4.6 ms: a boundary that is not a whole frame.
    const { mixer } = setup([
      segment({ clipId: 1, start: 0, duration: 4600 }),
      segment({ clipId: 2, start: 4600, duration: 5400, sourceIn: 4600 }),
    ]);
    await mixer.next();
    expect([...mixer.left]).toEqual(new Array(10).fill(1));
  });

  it('applies gain and sums overlapping tracks', async () => {
    const { mixer } = setup(
      [segment({ clipId: 1, gain: 0.5 }), segment({ clipId: 2, assetId: 'b', gain: 0.25 })],
      { a: 1, b: 1 },
    );
    await mixer.next();
    expect(mixer.left[0]).toBe(0.75);
  });

  it('opens a stream at the right source time after a seek', async () => {
    const { mixer, opened } = setup([
      segment({ clipId: 1, start: ms(2), sourceIn: ms(100), duration: ms(50) }),
    ]);
    mixer.seek(ms(12));
    await mixer.next();
    // 12 ms on the timeline is 10 ms into the clip, which starts 100 ms into the source.
    expect(opened.at(-1)!.startSeconds).toBeCloseTo(0.11);
    expect(mixer.positionUs).toBe(ms(22));
  });

  it('releases decoders once a clip is no longer audible', async () => {
    const { mixer, opened } = setup([segment({ clipId: 1, duration: ms(5) })]);
    await mixer.next(); // frames 0-9: clip active
    await mixer.next(); // frames 10-19: clip over
    expect(opened[0]!.disposed).toBe(true);
  });

  it('skips assets without audio', async () => {
    const { mixer } = setup([segment({ clipId: 1, assetId: 'silent' })], {});
    expect(await mixer.next()).toBe(true);
    expect([...mixer.left]).toEqual(new Array(10).fill(0));
  });

  it('does not drift over long renders', async () => {
    const { mixer } = setup([]);
    for (let i = 0; i < 10_000; i++) await mixer.next();
    expect(mixer.positionUs).toBe(ms(100_000));
  });

  it('reports a stale chunk when seek happens mid-decode', async () => {
    let release: () => void = () => {};
    const slow: AudioStream = {
      mixInto: () => new Promise<void>((resolve) => (release = resolve)),
      dispose: async () => {},
    };
    const mixer = new Mixer(() => slow, RATE, 10);
    mixer.setSegments([segment({ clipId: 1 })]);
    mixer.seek(0);
    const pending = mixer.next();
    mixer.seek(ms(500));
    release();
    expect(await pending).toBe(false);
    expect(mixer.positionUs).toBe(ms(500));
  });
});
