import type { CaptionStage, FromCaptionsWorker, SpeechDevice, ToCaptionsWorker } from './protocol';
import type { TimedText } from './segments';

export interface CaptionCallbacks {
  onProgress(stage: CaptionStage, fraction: number): void;
  onDone(words: TimedText[], durationUs: number, device: SpeechDevice): void;
  /** The graphics card failed; the run continues on the processor. */
  onFallback(reason: string): void;
  onError(message: string): void;
}

type CaptionRequest = Omit<ToCaptionsWorker, 'type'>;

/**
 * One captioning run, in its own worker that ends with the run, so a
 * cancelled run frees the model and the audio straight away. If the graphics
 * card fails, the run starts again on the processor in a fresh worker: a
 * failed GPU session can leave the old one's runtime unusable, and a new
 * worker also hands all of the GPU's memory back.
 */
export class CaptionJob {
  private worker: Worker | null = null;

  constructor(
    private readonly request: CaptionRequest,
    private readonly callbacks: CaptionCallbacks,
  ) {
    this.start(request);
  }

  private start(request: CaptionRequest) {
    const worker = new Worker(new URL('./captions.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<FromCaptionsWorker>) => this.handle(event.data);
    worker.onerror = (event) =>
      this.finish(() => this.callbacks.onError(event.message || 'The captions worker stopped.'));
    const message: ToCaptionsWorker = { type: 'start', ...request };
    worker.postMessage(message);
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
        this.finish(() => this.callbacks.onDone(message.words, message.durationUs, message.device));
        break;
      case 'fallback':
        this.worker?.terminate();
        this.callbacks.onFallback(message.reason);
        this.start({ ...this.request, device: 'cpu' });
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
