import { describe, expect, it } from 'vitest';
import { Resampler } from './resampler';
import {
  ANCHOR,
  clockFromBuffers,
  CONTROL,
  createRingBuffers,
  readQuantum,
  RingWriter,
} from './ring-buffer';

const ramp = (n: number, start = 0) => Float32Array.from({ length: n }, (_, i) => start + i);

describe('Resampler', () => {
  it('passes audio through unchanged at ratio 1', () => {
    const r = new Resampler(1);
    r.push(ramp(8), ramp(8, 100));
    const left = new Float32Array(4);
    const right = new Float32Array(4);
    r.mixInto(left, right, 0, 4, 1);
    expect([...left]).toEqual([0, 1, 2, 3]);
    expect([...right]).toEqual([100, 101, 102, 103]);
  });

  it('interpolates when upsampling and stays continuous across pulls', () => {
    const r = new Resampler(0.5); // e.g. 24 kHz -> 48 kHz
    r.push(ramp(8), ramp(8));
    const out = new Float32Array(6);
    r.mixInto(out, new Float32Array(6), 0, 3, 1);
    r.mixInto(out, new Float32Array(6), 3, 3, 1);
    expect([...out]).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });

  it('carries the fractional position across pushes', () => {
    const r = new Resampler(44_100 / 48_000);
    const out = new Float32Array(2000);
    let produced = 0;
    let next = 0;
    while (produced < out.length) {
      while (r.needs(500)) {
        r.push(ramp(441, next), ramp(441, next));
        next += 441;
      }
      r.mixInto(out, new Float32Array(out.length), produced, 500, 1);
      produced += 500;
    }
    // A ramp resampled linearly is still a ramp with slope = ratio.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]! - out[i - 1]!).toBeCloseTo(44_100 / 48_000, 3); // float32 resolution near 1800 is ~1e-4;
    }
  });

  it('mixes with gain and adds to existing output', () => {
    const r = new Resampler(1);
    r.push(Float32Array.of(1, 1, 1), Float32Array.of(1, 1, 1));
    const left = Float32Array.of(0.25, 0.25);
    r.mixInto(left, new Float32Array(2), 0, 2, 0.5);
    expect([...left]).toEqual([0.75, 0.75]);
  });

  it('honours skip for aligning the first chunk', () => {
    const r = new Resampler(1);
    r.push(ramp(10), ramp(10));
    r.skip(4);
    const left = new Float32Array(2);
    r.mixInto(left, new Float32Array(2), 0, 2, 1);
    expect([...left]).toEqual([4, 5]);
  });
});

describe('ring buffer', () => {
  const setup = (capacity = 8) => {
    const buffers = createRingBuffers(capacity);
    return {
      writer: new RingWriter(buffers),
      control: new Int32Array(buffers.control),
      anchor: new Float64Array(buffers.anchor),
      data: new Float32Array(buffers.data),
      capacity,
    };
  };

  it('delivers frames in order across the wrap-around', () => {
    const { writer, control, data, capacity } = setup(4);
    const left = new Float32Array(3);
    const right = new Float32Array(3);
    writer.write(ramp(3), ramp(3), 3);
    readQuantum(control, data, capacity, left, right);
    writer.write(ramp(3, 10), ramp(3, 10), 3); // wraps
    readQuantum(control, data, capacity, left, right);
    expect([...left]).toEqual([10, 11, 12]);
  });

  it('pads underruns with silence and counts them', () => {
    const { writer, control, data, capacity } = setup();
    writer.write(Float32Array.of(1), Float32Array.of(1), 1);
    const left = Float32Array.of(9, 9, 9);
    expect(readQuantum(control, data, capacity, left, new Float32Array(3))).toBe(1);
    expect([...left]).toEqual([1, 0, 0]);
    expect(control[CONTROL.UNDERRUNS]).toBe(1);
  });

  it('flush skips unplayed audio and re-anchors the clock', () => {
    const { writer, control, anchor, data, capacity } = setup();
    writer.write(ramp(6), ramp(6), 6);
    writer.flushAndAnchor(5_000_000, 1);
    writer.write(Float32Array.of(42, 43), Float32Array.of(42, 43), 2);
    const left = new Float32Array(2);
    readQuantum(control, data, capacity, left, new Float32Array(2));
    expect([...left]).toEqual([42, 43]);
    expect(anchor[ANCHOR.INDEX]).toBe(6);
    // 2 frames at 2 Hz = 1 second after the anchor.
    expect(clockFromBuffers(control, anchor, 2)).toBe(6_000_000);
  });

  it('clock holds at the anchor until the reader reaches it', () => {
    const { writer, control, anchor } = setup();
    writer.write(ramp(4), ramp(4), 4);
    writer.flushAndAnchor(1_000_000, 1);
    expect(clockFromBuffers(control, anchor, 48_000)).toBe(1_000_000);
  });
});
