/** One gain for every frame, or one gain per frame. */
export type Gain = number | Float32Array;

/** `linear`: cheap. `sinc`: a windowed-sinc filter, transparent (see `SINC`). */
export type ResampleQuality = 'linear' | 'sinc';

/**
 * Streaming stereo resampler.
 *
 * Source audio arrives in arbitrary-sized decoded chunks at the source rate;
 * the mixer pulls exactly the number of output frames it needs at the output
 * rate. A fractional read position carries across pulls, so there are no
 * clicks at chunk boundaries.
 *
 * Two qualities, behind one interface:
 * - **linear** interpolation between neighbouring samples: cheap, but it dulls
 *   high frequencies and, when lowering the rate, folds frequencies the new
 *   rate can't hold back down as aliasing.
 * - **sinc**: each output sample is a weighted sum of `2 × SINC.halfWidth`
 *   source samples around it (a Kaiser-windowed sinc, from a table). When the
 *   rate goes down, the cutoff follows the new Nyquist frequency, so those
 *   frequencies are filtered out instead of aliasing.
 */
export class Resampler {
  private left = new Float32Array(4096);
  private right = new Float32Array(4096);
  /** Valid source frames in the buffers. */
  private length = 0;
  /** Fractional read position in source frames. */
  private position = 0;
  private ended = false;

  private readonly kernel: SincKernel | null;
  /** Source frames needed after (and kept before) the read position. */
  private readonly reach: number;

  /** `ratio` = source rate / output rate. */
  constructor(
    private readonly ratio: number,
    quality: ResampleQuality = 'linear',
  ) {
    // At ratio 1 nothing is resampled: every quality passes samples through.
    this.kernel = quality === 'sinc' && ratio !== 1 ? sincKernel(ratio) : null;
    this.reach = this.kernel ? this.kernel.taps / 2 : 1;
  }

  /** Source frames needed beyond what is buffered to produce `frames` outputs. */
  needs(frames: number): boolean {
    if (this.ended) return false;
    const lastIndex = Math.floor(this.position + (frames - 1) * this.ratio) + this.reach;
    return lastIndex >= this.length;
  }

  /** Skip source frames (used to align the first decoded chunk). */
  skip(frames: number): void {
    this.position += Math.max(0, frames);
  }

  push(left: Float32Array, right: Float32Array): void {
    this.compact();
    const needed = this.length + left.length;
    if (needed > this.left.length) {
      const size = Math.max(needed, this.left.length * 2);
      this.left = grow(this.left, size, this.length);
      this.right = grow(this.right, size, this.length);
    }
    this.left.set(left, this.length);
    this.right.set(right, this.length);
    this.length += left.length;
  }

  /** No more source data will arrive; remaining output is padded with silence. */
  end(): void {
    this.ended = true;
  }

  /**
   * Mix `frames` resampled frames into `outLeft`/`outRight` starting at
   * `offset`, multiplied by `gain` (added, not overwritten, so several
   * sources can share one output buffer). `gain` is either one value or a
   * gain per output frame (`gain[i]` applies to frame `offset + i`).
   */
  mixInto(
    outLeft: Float32Array,
    outRight: Float32Array,
    offset: number,
    frames: number,
    gain: Gain,
  ): void {
    if (this.kernel) {
      this.mixSinc(this.kernel, outLeft, outRight, offset, frames, gain);
      this.position += frames * this.ratio;
      return;
    }
    const scalar = typeof gain === 'number' ? gain : 0;
    for (let i = 0; i < frames; i++) {
      const g = typeof gain === 'number' ? scalar : gain[i]!;
      const pos = this.position + i * this.ratio;
      const i0 = Math.floor(pos);
      if (i0 >= this.length) break; // out of data: silence
      const i1 = Math.min(i0 + 1, this.length - 1);
      const frac = pos - i0;
      outLeft[offset + i]! += (this.left[i0]! + (this.left[i1]! - this.left[i0]!) * frac) * g;
      outRight[offset + i]! += (this.right[i0]! + (this.right[i1]! - this.right[i0]!) * frac) * g;
    }
    this.position += frames * this.ratio;
  }

  private mixSinc(
    kernel: SincKernel,
    outLeft: Float32Array,
    outRight: Float32Array,
    offset: number,
    frames: number,
    gain: Gain,
  ): void {
    const { left, right, length } = this;
    const { table, phases, taps } = kernel;
    const half = taps / 2;
    for (let i = 0; i < frames; i++) {
      const pos = this.position + i * this.ratio;
      const base = Math.floor(pos);
      if (base >= length && this.ended) break; // past the end: silence
      // Blend the two nearest precomputed phases of the filter.
      const phase = (pos - base) * phases;
      const p = Math.floor(phase);
      const blend = phase - p;
      const row0 = p * taps;
      const row1 = row0 + taps;
      let l = 0;
      let r = 0;
      const first = base - half + 1;
      for (let k = 0; k < taps; k++) {
        const j = first + k;
        if (j < 0 || j >= length) continue; // silence before the start and after the end
        const w = table[row0 + k]! + (table[row1 + k]! - table[row0 + k]!) * blend;
        l += left[j]! * w;
        r += right[j]! * w;
      }
      const g = typeof gain === 'number' ? gain : gain[i]!;
      outLeft[offset + i]! += l * g;
      outRight[offset + i]! += r * g;
    }
  }

  /** Drop source frames that have been fully consumed (keeping what the filter still reads). */
  private compact(): void {
    const consumed = Math.min(Math.floor(this.position) - (this.reach - 1), this.length);
    if (consumed <= 0) return;
    this.left.copyWithin(0, consumed, this.length);
    this.right.copyWithin(0, consumed, this.length);
    this.length -= consumed;
    this.position -= consumed;
  }
}

function grow(buffer: Float32Array, size: number, used: number): Float32Array<ArrayBuffer> {
  const next = new Float32Array(size);
  next.set(buffer.subarray(0, used));
  return next;
}

/** The windowed-sinc filter's shape. */
export const SINC = {
  /**
   * Source samples on each side of the read position, when raising the rate
   * (32 taps in all); lowering it by a factor widens the filter by that factor.
   */
  halfWidth: 24,
  /** Precomputed fractional positions (blended linearly in between). */
  phases: 512,
  /** Kaiser window shape: about 80 dB of stopband attenuation. */
  beta: 8,
  /** The passband ends this far below the lower Nyquist frequency (the transition band). */
  rolloff: 0.94,
} as const;

interface SincKernel {
  /** `phases + 1` rows of `taps` weights: row p is for a read position p/phases past a sample. */
  table: Float32Array;
  phases: number;
  taps: number;
}

const kernels = new Map<number, SincKernel>();

/** The filter for a ratio (cached: every clip at the same rates shares one table). */
function sincKernel(ratio: number): SincKernel {
  const cached = kernels.get(ratio);
  if (cached) return cached;
  // Lowering the rate lowers the cutoff, which stretches the filter: widen it by the same
  // factor so it keeps as many lobes (and as sharp a transition) as at full rate.
  const half = Math.ceil(SINC.halfWidth * Math.max(1, ratio));
  const taps = 2 * half;
  const phases = SINC.phases;
  // Cutoff relative to the source's Nyquist frequency: lowered when the rate goes down.
  const cutoff = Math.min(1, 1 / ratio) * SINC.rolloff;
  const table = new Float32Array((phases + 1) * taps);
  const i0Beta = besselI0(SINC.beta);
  for (let p = 0; p <= phases; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const t = k - half + 1 - frac; // distance from the read position, in source samples
      const x = t / half;
      const window = Math.abs(x) >= 1 ? 0 : besselI0(SINC.beta * Math.sqrt(1 - x * x)) / i0Beta;
      const w = cutoff * sinc(cutoff * t) * window;
      table[p * taps + k] = w;
      sum += w;
    }
    // Unity gain at 0 Hz for every phase, so a constant stays exactly constant.
    for (let k = 0; k < taps; k++) table[p * taps + k]! /= sum;
  }
  const kernel = { table, phases, taps };
  kernels.set(ratio, kernel);
  return kernel;
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Modified Bessel function of the first kind, order 0 (for the Kaiser window). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}
