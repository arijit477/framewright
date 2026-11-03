/**
 * Real-time audio thread. Deliberately tiny: copy one render quantum out of the
 * shared ring buffer and measure its level. No allocation, no decoding, no
 * messages per quantum, so it never glitches.
 *
 * The READ index it advances is the editor's master clock.
 */
import { METER, readQuantum } from './ring-buffer';

// AudioWorkletGlobalScope types are not in the DOM lib.
declare const AudioWorkletProcessor: {
  prototype: { readonly port: MessagePort };
  new (): { readonly port: MessagePort };
};
declare function registerProcessor(name: string, ctor: unknown): void;

interface Init {
  control: SharedArrayBuffer;
  meter: SharedArrayBuffer;
  data: SharedArrayBuffer;
  capacity: number;
}

class RingPlayer extends AudioWorkletProcessor {
  private control: Int32Array | null = null;
  private meter: Float32Array | null = null;
  private data: Float32Array | null = null;
  private capacity = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Init>) => {
      this.control = new Int32Array(event.data.control);
      this.meter = new Float32Array(event.data.meter);
      this.data = new Float32Array(event.data.data);
      this.capacity = event.data.capacity;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output?.[0];
    if (!left || !this.control || !this.data || !this.meter) return true;
    const right = output[1] ?? new Float32Array(left.length);
    readQuantum(this.control, this.data, this.capacity, left, right);

    // Peak meter with a simple decay, read by the UI.
    this.meter[METER.PEAK_LEFT] = Math.max(peak(left), this.meter[METER.PEAK_LEFT]! * 0.97);
    this.meter[METER.PEAK_RIGHT] = Math.max(peak(right), this.meter[METER.PEAK_RIGHT]! * 0.97);
    return true;
  }
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > max) max = v;
  }
  return max;
}

registerProcessor('ring-player', RingPlayer);
