import type { AudioSegment } from '../engine/types';
import workletUrl from './player.worklet.ts?worker&url';
import type { FromAudioWorker, ToAudioWorker } from './protocol';
import { ANCHOR, clockFromBuffers, CONTROL, createRingBuffers, METER } from './ring-buffer';

const SAMPLE_RATE = 48_000;
/** Ring capacity: 1 s. The worker only fills ~0.25 s ahead, so edits are heard quickly. */
const CAPACITY = SAMPLE_RATE;

export interface AudioAssetInfo {
  hasAudio: boolean;
  durationUs: number;
}

/**
 * Main-thread handle to audio output. Owns the AudioContext, the worklet node
 * and the audio worker, and exposes the master clock.
 *
 * Requires cross-origin isolation (SharedArrayBuffer). Without it `available`
 * is false and the editor falls back to a wall clock with no sound.
 */
export class AudioOutput {
  readonly available = typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated;
  private readonly worker: Worker;
  private readonly buffers = createRingBuffers(CAPACITY);
  private readonly control = new Int32Array(this.buffers.control);
  private readonly anchor = new Float64Array(this.buffers.anchor);
  private readonly meter = new Float32Array(this.buffers.meter);
  private context: AudioContext | null = null;
  private contextReady: Promise<AudioContext> | null = null;
  private epoch = 0;
  private startUs = 0;
  private readonly waiters = new Map<
    string,
    { resolve: (info: AudioAssetInfo) => void; reject: (e: Error) => void }
  >();
  private peaksListener: ((id: string, peaks: Float32Array) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromAudioWorker>) => this.handle(event.data);
    if (this.available) {
      this.post({ type: 'init', buffers: this.buffers, sampleRate: SAMPLE_RATE });
    }
  }

  addAsset(id: string, file: File): Promise<AudioAssetInfo> {
    if (!this.available) return Promise.resolve({ hasAudio: false, durationUs: 0 });
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.post({ type: 'addAsset', id, file });
    });
  }

  /** Release every decoder (e.g. when another project is opened). */
  clearAssets(): void {
    if (this.available) this.post({ type: 'clearAssets' });
  }

  onPeaks(listener: (id: string, peaks: Float32Array) => void) {
    this.peaksListener = listener;
  }

  /** Start playback at `fromUs`. Call from a user gesture (browsers require it for audio). */
  async start(fromUs: number, segments: AudioSegment[]): Promise<void> {
    if (!this.available) return;
    this.epoch++;
    this.startUs = fromUs;
    this.post({ type: 'start', epoch: this.epoch, fromUs, segments });
    const context = await this.ensureContext();
    if (context.state !== 'running') await context.resume();
  }

  /** The timeline changed during playback. */
  update(segments: AudioSegment[]): void {
    if (!this.available) return;
    // Until the worker re-anchors, hold the clock where it is now.
    this.startUs = this.clockUs();
    this.epoch++;
    this.post({ type: 'update', epoch: this.epoch, segments });
  }

  stop(): void {
    if (!this.available) return;
    this.post({ type: 'stop' });
  }

  /**
   * Master clock: the timeline time currently coming out of the speakers.
   * Returns the start position until the worker has anchored the new playback.
   */
  clockUs(): number {
    if (Atomics.load(this.control, CONTROL.EPOCH) !== this.epoch) return this.startUs;
    const playing = clockFromBuffers(this.control, this.anchor, SAMPLE_RATE);
    // Frames leave the worklet before they reach the speakers.
    const latencyUs = ((this.context?.outputLatency ?? 0) + (this.context?.baseLatency ?? 0)) * 1e6;
    return Math.max(this.anchor[ANCHOR.TIME_US]!, playing - latencyUs);
  }

  /** Peak level per channel (0..1), for the level meter. */
  levels(): [number, number] {
    return [this.meter[METER.PEAK_LEFT]!, this.meter[METER.PEAK_RIGHT]!];
  }

  underruns(): number {
    return Atomics.load(this.control, CONTROL.UNDERRUNS);
  }

  private ensureContext(): Promise<AudioContext> {
    this.contextReady ??= (async () => {
      const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, 'ring-player', {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      node.port.postMessage({
        control: this.buffers.control,
        meter: this.buffers.meter,
        data: this.buffers.data,
        capacity: this.buffers.capacity,
      });
      node.connect(context.destination);
      this.context = context;
      return context;
    })();
    return this.contextReady;
  }

  private handle(message: FromAudioWorker) {
    switch (message.type) {
      case 'assetReady':
        this.waiters.get(message.id)?.resolve(message);
        this.waiters.delete(message.id);
        break;
      case 'assetError':
        this.waiters.get(message.id)?.reject(new Error(message.message));
        this.waiters.delete(message.id);
        break;
      case 'peaks':
        this.peaksListener?.(message.id, message.peaks);
        break;
      case 'error':
        console.error('[audio worker]', message.message);
        break;
    }
  }

  private post(message: ToAudioWorker) {
    this.worker.postMessage(message);
  }
}
