import type { Layer } from '../engine/types';
import type { AssetInfo, FromWorker, RendererBackend, ToWorker } from './protocol';

type Listener = (stats: { backend: RendererBackend | null; lastFrameMs: number }) => void;

/** Main-thread handle to the render worker. */
export class RenderClient {
  private readonly worker: Worker;
  private nextRequestId = 0;
  private readonly assetWaiters = new Map<
    string,
    { resolve: (a: AssetInfo) => void; reject: (e: Error) => void }
  >();
  private backend: RendererBackend | null = null;
  private lastFrameMs = 0;
  private listener: Listener | null = null;

  constructor() {
    this.worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.handle(event.data);
  }

  /** Hand the preview canvas to the worker. Can only happen once per canvas. */
  attach(canvas: HTMLCanvasElement): void {
    const offscreen = canvas.transferControlToOffscreen();
    this.post({ type: 'init', canvas: offscreen }, [offscreen]);
  }

  addAsset(id: string, file: File): Promise<AssetInfo> {
    return new Promise((resolve, reject) => {
      this.assetWaiters.set(id, { resolve, reject });
      this.post({ type: 'addAsset', id, file });
    });
  }

  /** Release every decoder (e.g. when another project is opened). */
  clearAssets(): void {
    this.post({ type: 'clearAssets' });
  }

  render(layers: Layer[]): void {
    this.post({ type: 'render', requestId: ++this.nextRequestId, layers });
  }

  onStats(listener: Listener): void {
    this.listener = listener;
  }

  private handle(message: FromWorker) {
    switch (message.type) {
      case 'ready':
        this.backend = message.backend;
        this.emit();
        break;
      case 'assetReady':
        this.assetWaiters.get(message.asset.id)?.resolve(message.asset);
        this.assetWaiters.delete(message.asset.id);
        break;
      case 'assetError':
        this.assetWaiters.get(message.id)?.reject(new Error(message.message));
        this.assetWaiters.delete(message.id);
        break;
      case 'rendered':
        this.lastFrameMs = message.ms;
        this.emit();
        break;
      case 'error':
        console.error('[render worker]', message.message);
        break;
    }
  }

  private emit() {
    this.listener?.({ backend: this.backend, lastFrameMs: this.lastFrameMs });
  }

  private post(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }
}
