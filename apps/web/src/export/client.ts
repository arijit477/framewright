import type { LutData } from '../render/protocol';
import type {
  ExportAsset,
  ExportDestination,
  ExportResult,
  FromExportWorker,
  ToExportWorker,
} from './protocol';
import type { ExportSettings } from './settings';

export interface ExportCallbacks {
  onProgress(progress: { framesDone: number; totalFrames: number; elapsedMs: number }): void;
  onDone(result: ExportResult): void;
  onCancelled(): void;
  onError(message: string): void;
}

/**
 * One export run. Each job gets a fresh worker that is terminated when the
 * job ends, so a failed or cancelled export can't leak decoders or memory
 * into the next one.
 */
export class ExportJob {
  private worker: Worker | null;

  constructor(
    projectJson: string,
    assets: ExportAsset[],
    luts: LutData[],
    settings: ExportSettings,
    destination: ExportDestination,
    private readonly callbacks: ExportCallbacks,
  ) {
    this.worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromExportWorker>) => this.handle(event.data);
    this.worker.onerror = (event) =>
      this.finish(() => callbacks.onError(event.message || 'Export worker crashed'));
    this.post({ type: 'start', projectJson, assets, luts, settings, destination });
  }

  cancel(): void {
    this.post({ type: 'cancel' });
  }

  private handle(message: FromExportWorker) {
    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message);
        break;
      case 'done': {
        const { type, ...result } = message;
        this.finish(() => this.callbacks.onDone(result));
        break;
      }
      case 'cancelled':
        this.finish(() => this.callbacks.onCancelled());
        break;
      case 'error':
        this.finish(() => this.callbacks.onError(message.message));
        break;
    }
  }

  private finish(report: () => void) {
    this.worker?.terminate();
    this.worker = null;
    report();
  }

  private post(message: ToExportWorker) {
    this.worker?.postMessage(message);
  }
}
