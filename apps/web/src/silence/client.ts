import type { SilenceOptions } from './detect';
import type { FromSilenceWorker, ToSilenceWorker } from './protocol';

export interface SilenceCallbacks {
  onProgress(fraction: number): void;
  onDone(silences: { clipId: number; ranges: [number, number][] }[]): void;
  onError(message: string): void;
}

/** One analysis, in its own worker that ends with it. */
export class SilenceJob {
  private worker: Worker | null;

  constructor(
    request: Omit<ToSilenceWorker, 'type' | 'options'> & { options: SilenceOptions },
    private readonly callbacks: SilenceCallbacks,
  ) {
    this.worker = new Worker(new URL('./silence.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromSilenceWorker>) => this.handle(event.data);
    this.worker.onerror = (event) =>
      this.finish(() => callbacks.onError(event.message || 'The silence worker stopped.'));
    const message: ToSilenceWorker = { type: 'start', ...request };
    this.worker.postMessage(message);
  }

  cancel(): void {
    this.finish(() => {});
  }

  private handle(message: FromSilenceWorker) {
    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message.fraction);
        break;
      case 'done':
        this.finish(() => this.callbacks.onDone(message.silences));
        break;
      case 'error':
        this.finish(() => this.callbacks.onError(message.message));
        break;
    }
  }

  private finish(then: () => void) {
    this.worker?.terminate();
    this.worker = null;
    then();
  }
}
