/**
 * Lock-free single-producer / single-consumer ring buffer of stereo float
 * frames, shared between the audio worker (writer) and the AudioWorklet
 * (reader) through SharedArrayBuffers.
 *
 * Indices only ever grow; the slot is `index % capacity`. The writer owns
 * WRITE, the reader owns READ, so neither needs a lock.
 *
 * Flushing (seek, edit, stop) is requested by the writer and performed by the
 * reader: the writer publishes SKIP_TO and raises SKIP_FLAG; at the start of
 * its next render quantum the reader jumps READ forward. This avoids the race
 * where both sides would otherwise write READ.
 *
 * The master clock maps frame indices to timeline time through an anchor:
 * frame ANCHOR_INDEX is timeline time ANCHOR_TIME_US.
 */

export const CONTROL = {
  WRITE: 0,
  READ: 1,
  SKIP_TO: 2,
  SKIP_FLAG: 3,
  /** Incremented by the writer after it re-anchors, so readers of the clock know it is valid. */
  EPOCH: 4,
  /** Render quanta that found the buffer empty. */
  UNDERRUNS: 5,
  LENGTH: 6,
} as const;

export const ANCHOR = { INDEX: 0, TIME_US: 1, LENGTH: 2 } as const;
export const METER = { PEAK_LEFT: 0, PEAK_RIGHT: 1, LENGTH: 2 } as const;

export interface RingBuffers {
  control: SharedArrayBuffer;
  anchor: SharedArrayBuffer;
  meter: SharedArrayBuffer;
  data: SharedArrayBuffer;
  capacity: number;
}

export function createRingBuffers(capacity: number): RingBuffers {
  return {
    control: new SharedArrayBuffer(CONTROL.LENGTH * Int32Array.BYTES_PER_ELEMENT),
    anchor: new SharedArrayBuffer(ANCHOR.LENGTH * Float64Array.BYTES_PER_ELEMENT),
    meter: new SharedArrayBuffer(METER.LENGTH * Float32Array.BYTES_PER_ELEMENT),
    data: new SharedArrayBuffer(capacity * 2 * Float32Array.BYTES_PER_ELEMENT),
    capacity,
  };
}

/** Writer side, used by the audio worker. */
export class RingWriter {
  private readonly control: Int32Array;
  private readonly anchor: Float64Array;
  private readonly data: Float32Array;

  constructor(private readonly buffers: RingBuffers) {
    this.control = new Int32Array(buffers.control);
    this.anchor = new Float64Array(buffers.anchor);
    this.data = new Float32Array(buffers.data);
  }

  /** Frames written but not yet played. */
  buffered(): number {
    return Atomics.load(this.control, CONTROL.WRITE) - Atomics.load(this.control, CONTROL.READ);
  }

  free(): number {
    return this.buffers.capacity - this.buffered();
  }

  /** Append stereo frames. The caller must check `free()` first. */
  write(left: Float32Array, right: Float32Array, frames: number): void {
    const { capacity } = this.buffers;
    let index = Atomics.load(this.control, CONTROL.WRITE);
    for (let i = 0; i < frames; i++, index++) {
      const slot = (index % capacity) * 2;
      this.data[slot] = left[i]!;
      this.data[slot + 1] = right[i]!;
    }
    Atomics.store(this.control, CONTROL.WRITE, index);
  }

  /**
   * Drop everything not yet played and anchor the next written frame at
   * `timeUs`, then publish `epoch` so the main thread knows the clock is valid.
   */
  flushAndAnchor(timeUs: number, epoch: number): void {
    const writeIndex = Atomics.load(this.control, CONTROL.WRITE);
    Atomics.store(this.control, CONTROL.SKIP_TO, writeIndex);
    Atomics.store(this.control, CONTROL.SKIP_FLAG, 1);
    this.anchor[ANCHOR.INDEX] = writeIndex;
    this.anchor[ANCHOR.TIME_US] = timeUs;
    Atomics.store(this.control, CONTROL.EPOCH, epoch);
  }

  /** Timeline time of the frame the reader will play next. */
  playingTimeUs(sampleRate: number): number {
    return clockFromBuffers(this.control, this.anchor, sampleRate);
  }
}

/** Timeline time of the next frame to play, clamped to the anchor. */
export function clockFromBuffers(control: Int32Array, anchor: Float64Array, sampleRate: number) {
  const read = Atomics.load(control, CONTROL.READ);
  const framesSinceAnchor = Math.max(0, read - anchor[ANCHOR.INDEX]!);
  return anchor[ANCHOR.TIME_US]! + (framesSinceAnchor / sampleRate) * 1_000_000;
}

/**
 * Reader side, used by the AudioWorklet. Fills one render quantum and returns
 * the number of frames that came from the buffer (the rest is silence).
 */
export function readQuantum(
  control: Int32Array,
  data: Float32Array,
  capacity: number,
  left: Float32Array,
  right: Float32Array,
): number {
  if (Atomics.exchange(control, CONTROL.SKIP_FLAG, 0) === 1) {
    const skipTo = Atomics.load(control, CONTROL.SKIP_TO);
    if (skipTo > Atomics.load(control, CONTROL.READ)) Atomics.store(control, CONTROL.READ, skipTo);
  }
  let read = Atomics.load(control, CONTROL.READ);
  const available = Math.max(0, Atomics.load(control, CONTROL.WRITE) - read);
  const frames = Math.min(left.length, available);
  for (let i = 0; i < frames; i++, read++) {
    const slot = (read % capacity) * 2;
    left[i] = data[slot]!;
    right[i] = data[slot + 1]!;
  }
  left.fill(0, frames);
  right.fill(0, frames);
  Atomics.store(control, CONTROL.READ, read);
  if (frames < left.length) Atomics.add(control, CONTROL.UNDERRUNS, 1);
  return frames;
}
