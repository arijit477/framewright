import type { ExportAsset } from '../export/protocol';
import type { CaptionModel, CaptionStage, FromCaptionsWorker, ToCaptionsWorker } from './protocol';
import type { TimedText } from './segments';

export interface CaptionCallbacks {
  onProgress(stage: CaptionStage, fraction: number): void;
  onDone(phrases: TimedText[], durationUs: number): void;
  onError(message: string): void;
}

/**
 * One captioning run, in its own worker that ends with the run, so a
 * cancelled run frees the model and the audio straight away.
 */
export class CaptionJob {
  private worker: Worker | null;

  constructor(
    request: {
      projectJson: string;
      assets: ExportAsset[];
      model: CaptionModel;
      language: string | null;
    },
    private readonly callbacks: CaptionCallbacks,
  ) {
    this.worker = new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromCaptionsWorker>) => this.handle(event.data);
    this.worker.onerror = (event) =>
      this.finish(() => callbacks.onError(event.message || 'The captions worker stopped.'));
    const message: ToCaptionsWorker = { type: 'start', ...request };
    this.worker.postMessage(message);
  }

  cancel(): void {
    this.finish(() => {});
  }

  private handle(message: FromCaptionsWorker) {
    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message.stage, message.fraction);
        break;
      case 'done':
        this.finish(() => this.callbacks.onDone(message.phrases, message.durationUs));
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
