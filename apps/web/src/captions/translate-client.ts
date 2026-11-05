import type { FromTranslationWorker, ToTranslationWorker, TranslationStage } from './translation';

export interface TranslationCallbacks {
  onProgress(stage: TranslationStage, fraction: number, step: number, steps: number): void;
  onDone(texts: string[]): void;
  onError(message: string): void;
}

/** One translation run, in its own worker that ends with it (cancelling frees the model). */
export class TranslationJob {
  private worker: Worker | null;

  constructor(
    request: Omit<ToTranslationWorker, 'type'>,
    private readonly callbacks: TranslationCallbacks,
  ) {
    this.worker = new Worker(new URL('./translate.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<FromTranslationWorker>) => this.handle(event.data);
    this.worker.onerror = (event) =>
      this.finish(() => callbacks.onError(event.message || 'The translation worker stopped.'));
    const message: ToTranslationWorker = { type: 'start', ...request };
    this.worker.postMessage(message);
  }

  cancel(): void {
    this.finish(() => {});
  }

  private handle(message: FromTranslationWorker) {
    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message.stage, message.fraction, message.step, message.steps);
        break;
      case 'done':
        this.finish(() => this.callbacks.onDone(message.texts));
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
