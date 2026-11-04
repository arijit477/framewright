import type { Gain } from './resampler';

/**
 * Pitch-preserving time stretch (WSOLA: waveform-similarity overlap-add).
 *
 * Output is built from overlapping windows of the input, one every `hop`
 * output frames, taken `hop × speed` apart in the input. Each window's exact
 * position is nudged (within ±`tolerance`) to where the input best matches
 * the natural continuation of the previous window, so the overlaps line up
 * in phase and the pitch is kept, without the "chipmunk" effect of simply
 * playing faster.
 *
 * Streaming: `push` input (stereo, at the output rate), `mixInto` takes
 * output as it becomes available. Everything is in frames at one sample rate.
 */
export class TimeStretcher {
  private readonly size: number;
  private readonly hop: number;
  private readonly tolerance: number;
  private readonly window: Float32Array;

  // Input not yet consumed; `inBase` is the absolute frame index of `inLeft[0]`.
  private inLeft = new Float32Array(16384);
  private inRight = new Float32Array(16384);
  private inLength = 0;
  private inBase = 0;

  /** Ideal absolute input position of the next window. */
  private nominal = 0;
  /** Absolute input position of the previous window (null before the first). */
  private previous: number | null = null;

  // Overlap-add accumulator (one window long) and finished output.
  private readonly olaLeft: Float32Array;
  private readonly olaRight: Float32Array;
  private outLeft = new Float32Array(8192);
  private outRight = new Float32Array(8192);
  private outLength = 0;

  constructor(
    readonly speed: number,
    sampleRate: number,
  ) {
    // 40 ms windows overlapping by half; search ±12 ms (enough for pitches down to ~80 Hz).
    this.hop = Math.round((sampleRate * 0.02) / 2) * 2;
    this.size = this.hop * 2;
    this.tolerance = Math.round(sampleRate * 0.012);
    // Periodic Hann: two windows half a window apart sum to exactly 1.
    this.window = Float32Array.from(
      { length: this.size },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.size),
    );
    this.olaLeft = new Float32Array(this.size);
    this.olaRight = new Float32Array(this.size);
  }

  /** Output frames ready to be taken. */
  get available(): number {
    return this.outLength;
  }

  push(left: Float32Array, right: Float32Array): void {
    const needed = this.inLength + left.length;
    if (needed > this.inLeft.length) {
      const size = Math.max(needed, this.inLeft.length * 2);
      this.inLeft = grow(this.inLeft, size, this.inLength);
      this.inRight = grow(this.inRight, size, this.inLength);
    }
    this.inLeft.set(left, this.inLength);
    this.inRight.set(right, this.inLength);
    this.inLength += left.length;
    this.process();
  }

  /**
   * Add `frames` output frames times `gain` into the buffers at `offset`
   * (silence for any not yet available), consuming them.
   */
  mixInto(left: Float32Array, right: Float32Array, offset: number, frames: number, gain: Gain) {
    const n = Math.min(frames, this.outLength);
    for (let i = 0; i < n; i++) {
      const g = typeof gain === 'number' ? gain : gain[i]!;
      left[offset + i]! += this.outLeft[i]! * g;
      right[offset + i]! += this.outRight[i]! * g;
    }
    this.outLeft.copyWithin(0, n, this.outLength);
    this.outRight.copyWithin(0, n, this.outLength);
    this.outLength -= n;
  }

  /** Emit windows while there is enough input for them. */
  private process(): void {
    const { size, hop, tolerance } = this;
    const inEnd = this.inBase + this.inLength;
    for (;;) {
      const target = Math.round(this.nominal);
      let start: number;
      if (this.previous === null) {
        if (target + size > inEnd) return;
        start = target;
      } else {
        const natural = this.previous + hop;
        if (target + tolerance + size > inEnd || natural + hop > inEnd) return;
        start = this.bestMatch(
          Math.max(target - tolerance, this.inBase),
          target + tolerance,
          natural,
        );
      }
      this.addWindow(start);
      this.previous = start;
      this.nominal += hop * this.speed;
      this.discardConsumedInput();
    }
  }

  /**
   * The start in [from, to] whose first `hop` frames best match the input at
   * `natural` (normalised cross-correlation of the mono mix; every 4th frame
   * is compared, which is plenty to align and 4× cheaper).
   */
  private bestMatch(from: number, to: number, natural: number): number {
    const { hop, inLeft, inRight, inBase } = this;
    const reference = natural - inBase;
    let best = from;
    let bestScore = -Infinity;
    for (let candidate = from; candidate <= to; candidate++) {
      const offset = candidate - inBase;
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < hop; i += 4) {
        const a = inLeft[offset + i]! + inRight[offset + i]!;
        const b = inLeft[reference + i]! + inRight[reference + i]!;
        dot += a * b;
        energy += a * a;
      }
      const score = dot / Math.sqrt(energy);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  /** Overlap-add the window at absolute input `start`, then emit the finished `hop` frames. */
  private addWindow(start: number): void {
    const { size, hop, window, olaLeft, olaRight } = this;
    const offset = start - this.inBase;
    // The very first window starts at full level (no fade-in at the start of a clip).
    const first = this.previous === null;
    for (let i = 0; i < size; i++) {
      const w = first && i < hop ? 1 : window[i]!;
      olaLeft[i]! += this.inLeft[offset + i]! * w;
      olaRight[i]! += this.inRight[offset + i]! * w;
    }
    if (this.outLength + hop > this.outLeft.length) {
      const grown = this.outLeft.length * 2;
      this.outLeft = grow(this.outLeft, grown, this.outLength);
      this.outRight = grow(this.outRight, grown, this.outLength);
    }
    this.outLeft.set(olaLeft.subarray(0, hop), this.outLength);
    this.outRight.set(olaRight.subarray(0, hop), this.outLength);
    this.outLength += hop;
    olaLeft.copyWithin(0, hop);
    olaRight.copyWithin(0, hop);
    olaLeft.fill(0, size - hop);
    olaRight.fill(0, size - hop);
  }

  /** Drop input no future window or comparison can reach. */
  private discardConsumedInput(): void {
    const keepFrom = Math.min(this.previous! + this.hop, Math.round(this.nominal) - this.tolerance);
    const drop = Math.max(0, Math.min(keepFrom - this.inBase, this.inLength));
    if (drop === 0) return;
    this.inLeft.copyWithin(0, drop, this.inLength);
    this.inRight.copyWithin(0, drop, this.inLength);
    this.inLength -= drop;
    this.inBase += drop;
  }
}

function grow(buffer: Float32Array, size: number, used: number): Float32Array<ArrayBuffer> {
  const next = new Float32Array(size);
  next.set(buffer.subarray(0, used));
  return next;
}
