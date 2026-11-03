/**
 * Render worker: owns decoding and compositing so the UI thread never blocks.
 *
 * The main thread sends "render these layers" requests. Only the newest pending
 * request is processed; older ones are dropped. That keeps scrubbing responsive
 * and lets playback skip frames instead of falling behind.
 */
import { VideoSampleSink, type VideoSample } from 'mediabunny';
import type { Layer } from '../engine/types';
import { openAsset, toMicros } from '../media/asset';
import { createCompositor, type Compositor } from './compositor';
import { FrameReader } from './frame-reader';
import { COMPOSITION, type FromWorker, type ToWorker } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
}
const scope = self as unknown as WorkerScope;
const send = (message: FromWorker) => scope.postMessage(message);

let compositor: Compositor | null = null;
const readers = new Map<string, FrameReader>();
let pending: { requestId: number; layers: Layer[] } | null = null;
let rendering = false;

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      void init(message.canvas);
      break;
    case 'addAsset':
      void addAsset(message.id, message.file);
      break;
    case 'render':
      pending = { requestId: message.requestId, layers: message.layers };
      void drain();
      break;
  }
};

async function init(canvas: OffscreenCanvas) {
  canvas.width = COMPOSITION.width;
  canvas.height = COMPOSITION.height;
  try {
    compositor = await createCompositor(canvas);
    send({ type: 'ready', backend: compositor.backend });
    void drain();
  } catch (error) {
    send({ type: 'error', message: String(error) });
  }
}

async function addAsset(id: string, file: File) {
  try {
    const { video, durationUs } = await openAsset(file);
    // Video clips last as long as their video track; audio-only files use the container.
    const videoDurationUs = video ? toMicros(await video.computeDuration()) : durationUs;
    if (video) readers.set(id, new FrameReader(new VideoSampleSink(video)));
    send({
      type: 'assetReady',
      asset: {
        id,
        name: file.name,
        durationUs: videoDurationUs,
        width: video?.displayWidth ?? 0,
        height: video?.displayHeight ?? 0,
        codec: video?.codec ?? null,
        hasVideo: video !== null,
        hasAudio: false, // filled in by the audio worker
      },
    });
  } catch (error) {
    send({
      type: 'assetError',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function drain() {
  if (rendering || !compositor) return;
  rendering = true;
  try {
    while (pending) {
      const { requestId, layers } = pending;
      pending = null;
      const started = performance.now();
      const frames = await Promise.all(
        layers.map((layer) => readers.get(layer.assetId)?.frameAt(layer.sourceTime / 1_000_000)),
      );
      compositor.draw(frames.filter((f): f is VideoSample => f != null));
      send({ type: 'rendered', requestId, ms: performance.now() - started });
    }
  } catch (error) {
    send({ type: 'error', message: String(error) });
  } finally {
    rendering = false;
  }
}
