import type { FrameFaces } from './path';
import type { FromReframeWorker, ToReframeWorker } from './protocol';

export interface ReframeCallbacks {
  onProgress(fraction: number): void;
  onDone(frames: FrameFaces[], size: { width: number; height: number }): void;
  onError(message: string): void;
}

/** One analysis, in its own worker that ends with it. */
export class ReframeJob {
  private worker: Worker | null;

  constructor(
    request: Omit<ToReframeWorker, 'type'>,
    private readonly callbacks: ReframeCallbacks,
  ) {
    this.worker = new Worker(new URL('./reframe.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromReframeWorker>) => this.handle(event.data);
    this.worker.onerror = (event) =>
      this.finish(() => callbacks.onError(event.message || 'The reframing worker stopped.'));
    const message: ToReframeWorker = { type: 'start', ...request };
    this.worker.postMessage(message);
  }

  cancel(): void {
    this.finish(() => {});
  }

  private handle(message: FromReframeWorker) {
    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message.fraction);
        break;
      case 'done':
        this.finish(() =>
          this.callbacks.onDone(message.frames, { width: message.width, height: message.height }),
        );
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
