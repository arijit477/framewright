import { describe, expect, it } from 'vitest';
import type { AudioSegment } from '../engine/types';
import { Mixer, type AudioStream } from './mixer';
import type { Gain } from './resampler';

const RATE = 1000; // 1 frame = 1 ms, so the maths is easy to read
const ms = (n: number) => n * 1000; // ms -> µs

/** A fake source that outputs a constant value and records where it was opened. */
class ConstantStream implements AudioStream {
  disposed = false;
  constructor(
    readonly value: number,
    readonly startSeconds: number,
    readonly speed = 1,
  ) {}
  async mixInto(l: Float32Array, r: Float32Array, offset: number, frames: number, gain: Gain) {
    for (let i = 0; i < frames; i++) {
      const g = typeof gain === 'number' ? gain : gain[i]!;
      l[offset + i]! += this.value * g;
      r[offset + i]! += this.value * g;
    }
  }
  async dispose() {
    this.disposed = true;
  }
}

function setup(segments: AudioSegment[], values: Record<string, number> = { a: 1, b: 1 }) {
  const opened: ConstantStream[] = [];
  const mixer = new Mixer(
    (assetId, startSeconds, speed) => {
      const value = values[assetId];
      if (value === undefined) return null;
      const stream = new ConstantStream(value, startSeconds, speed);
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
  speed: 1,
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

  it('opens sped-up clips at the right source time and speed', async () => {
    const { mixer, opened } = setup([
      segment({ clipId: 1, start: ms(2), sourceIn: ms(100), duration: ms(50), speed: 2 }),
    ]);
    mixer.seek(ms(12));
    await mixer.next();
    // 10 ms into the clip at 2x is 20 ms into its media.
    expect(opened.at(-1)!.startSeconds).toBeCloseTo(0.12);
    expect(opened.at(-1)!.speed).toBe(2);
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

  it('ramps gain per frame through a fade', async () => {
    const { mixer } = setup([
      segment({ clipId: 1, fadeIn: { start: 0, end: ms(10), curve: 'linear' } }),
    ]);
    await mixer.next();
    // Frame i sits at i ms, so a 10 ms linear ramp gives i / 10.
    expect([...mixer.left].map((v) => Math.round(v * 10) / 10)).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
    ]);
  });

  it('keeps an equal-power crossfade at constant power', async () => {
    const fade = { start: 0, end: ms(10), curve: 'equalPower' as const };
    const { mixer } = setup([
      segment({ clipId: 1, gain: 0.5, fadeOut: fade }),
      segment({ clipId: 2, assetId: 'b', fadeIn: fade }),
    ]);
    await mixer.next();
    // Not a real power sum (the fakes are correlated), so check each side's curve instead.
    const out = Math.cos(Math.PI / 4) * 0.5;
    const into = Math.sin(Math.PI / 4);
    expect(mixer.left[5]).toBeCloseTo(out + into);
  });

  it('uses one gain once a fade is over', async () => {
    const seen: Gain[] = [];
    const recording: AudioStream = {
      mixInto: async (_l, _r, _o, _f, gain) => void seen.push(gain),
      dispose: async () => {},
    };
    const mixer = new Mixer(() => recording, RATE, 10);
    mixer.setSegments([
      segment({
        clipId: 1,
        duration: ms(30),
        gain: 0.5,
        fadeIn: { start: 0, end: ms(10), curve: 'linear' },
      }),
    ]);
    mixer.seek(0);
    await mixer.next();
    await mixer.next();
    expect(seen[0]).toBeInstanceOf(Float32Array);
    expect(seen[1]).toBe(0.5);
  });
});
