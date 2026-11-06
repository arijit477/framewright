import { describe, expect, it } from 'vitest';
import { Resampler, type ResampleQuality } from './resampler';

/** Resample `seconds` of a sine (amplitude 0.5) from `from` Hz to `to` Hz, in odd-sized chunks. */
function resampleSine(
  hz: number,
  from: number,
  to: number,
  quality: ResampleQuality,
  seconds = 0.5,
) {
  const r = new Resampler(from / to, quality);
  const input = Float32Array.from(
    { length: Math.round(from * seconds) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / from),
  );
  const frames = Math.floor(to * seconds) - 64;
  const out = new Float32Array(frames);
  let fed = 0;
  for (let done = 0; done < frames; done += 300) {
    const n = Math.min(300, frames - done);
    while (r.needs(n) && fed < input.length) {
      const chunk = input.subarray(fed, Math.min(input.length, fed + 997));
      r.push(chunk, chunk);
      fed += chunk.length;
    }
    if (fed >= input.length) r.end();
    r.mixInto(out, new Float32Array(frames), done, n, 1);
  }
  return out;
}

/** RMS (dBFS-ish, re amplitude 1) of `values`, skipping the edges. */
function rmsDb(values: ArrayLike<number>, skip = 200): number {
  let sum = 0;
  let n = 0;
  for (let i = skip; i < values.length - skip; i++) {
    sum += values[i]! ** 2;
    n++;
  }
  return 10 * Math.log10(sum / n + 1e-30);
}

/** The error against the ideal sine at the output rate. */
function errorDb(out: Float32Array, hz: number, to: number): number {
  const error = out.map((v, i) => v - 0.5 * Math.sin((2 * Math.PI * hz * i) / to));
  return rmsDb(error);
}

describe('windowed-sinc resampling', () => {
  // Errors are in dB relative to full scale; the test tone itself is at -9 dB.
  // Measured (24 taps a side): every case below -93 dB. Linear for comparison:
  // -14.7, -63.7, -9.0 (aliasing at full level) and -162 (an exact 3:1).

  it('reproduces high tones accurately when raising the rate', () => {
    expect(errorDb(resampleSine(9000, 22_050, 48_000, 'sinc'), 9000, 48_000)).toBeLessThan(-90);
    expect(errorDb(resampleSine(1000, 44_100, 48_000, 'sinc'), 1000, 48_000)).toBeLessThan(-90);
    // Linear interpolation dulls a 9 kHz tone: its error is nearly as loud as the tone.
    expect(errorDb(resampleSine(9000, 22_050, 48_000, 'linear'), 9000, 48_000)).toBeGreaterThan(
      -20,
    );
  });

  it('filters out what a lower rate can’t hold, instead of aliasing it', () => {
    // 12 kHz can't exist at 16 kHz (8 kHz Nyquist): linear folds it to 4 kHz at full level.
    expect(rmsDb(resampleSine(12_000, 48_000, 16_000, 'sinc'))).toBeLessThan(-90);
    expect(rmsDb(resampleSine(12_000, 48_000, 16_000, 'linear'))).toBeGreaterThan(-12);
    // ...while what it can hold passes untouched.
    expect(errorDb(resampleSine(5000, 48_000, 16_000, 'sinc'), 5000, 16_000)).toBeLessThan(-85);
  });

  it('gives the same output however the audio is chunked, and keeps a constant constant', () => {
    const run = (pushSize: number, pullSize: number) => {
      const r = new Resampler(44_100 / 48_000, 'sinc');
      const input = Float32Array.from({ length: 20_000 }, (_, i) => Math.sin(i * 0.07) * 0.3);
      const out = new Float32Array(15_000);
      let fed = 0;
      for (let done = 0; done < out.length; done += pullSize) {
        const n = Math.min(pullSize, out.length - done);
        while (r.needs(n) && fed < input.length) {
          const chunk = input.subarray(fed, fed + pushSize);
          r.push(chunk, chunk);
          fed += chunk.length;
        }
        r.mixInto(out, new Float32Array(out.length), done, n, 1);
      }
      return out;
    };
    const a = run(997, 300);
    const b = run(64, 1024);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, 6);

    const r = new Resampler(22_050 / 48_000, 'sinc');
    const ones = new Float32Array(4000).fill(1);
    r.push(ones, ones);
    const out = new Float32Array(2000);
    r.mixInto(out, new Float32Array(2000), 0, 2000, 1);
    // Away from the start (silence before the first sample), a constant stays exactly 1.
    for (let i = 100; i < 2000; i++) expect(out[i]).toBeCloseTo(1, 5);
  });

  it('passes samples straight through at equal rates', () => {
    const r = new Resampler(1, 'sinc');
    r.push(Float32Array.of(1, 2, 3, 4), Float32Array.of(1, 2, 3, 4));
    const out = new Float32Array(3);
    r.mixInto(out, new Float32Array(3), 0, 3, 1);
    expect([...out]).toEqual([1, 2, 3]);
  });
});
