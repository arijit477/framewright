/**
 * Streaming stereo resampler with linear interpolation.
 *
 * Source audio arrives in arbitrary-sized decoded chunks at the source rate;
 * the mixer pulls exactly the number of output frames it needs at the output
 * rate. A fractional read position carries across pulls, so there are no
 * clicks at chunk boundaries.
 *
 * Linear interpolation is cheap and fine for an editing preview. Export can
 * swap in a windowed-sinc resampler (e.g. in the Rust engine) behind the same
 * interface.
 */
export class Resampler {
  private left = new Float32Array(4096);
  private right = new Float32Array(4096);
  /** Valid source frames in the buffers. */
  private length = 0;
  /** Fractional read position in source frames. */
  private position = 0;
  private ended = false;

  /** `ratio` = source rate / output rate. */
  constructor(private readonly ratio: number) {}

  /** Source frames needed beyond what is buffered to produce `frames` outputs. */
  needs(frames: number): boolean {
    if (this.ended) return false;
    const lastIndex = Math.floor(this.position + (frames - 1) * this.ratio) + 1;
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
   * sources can share one output buffer).
   */
  mixInto(
    outLeft: Float32Array,
    outRight: Float32Array,
    offset: number,
    frames: number,
    gain: number,
  ): void {
    for (let i = 0; i < frames; i++) {
      const pos = this.position + i * this.ratio;
      const i0 = Math.floor(pos);
      if (i0 >= this.length) break; // out of data: silence
      const i1 = Math.min(i0 + 1, this.length - 1);
      const frac = pos - i0;
      outLeft[offset + i]! += (this.left[i0]! + (this.left[i1]! - this.left[i0]!) * frac) * gain;
      outRight[offset + i]! +=
        (this.right[i0]! + (this.right[i1]! - this.right[i0]!) * frac) * gain;
    }
    this.position += frames * this.ratio;
  }

  /** Drop source frames that have been fully consumed. */
  private compact(): void {
    const consumed = Math.min(Math.floor(this.position), this.length);
    if (consumed === 0) return;
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
