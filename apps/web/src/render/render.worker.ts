/**
 * Render worker: owns decoding and compositing so the UI thread never blocks.
 *
 * The main thread sends "render these layers" requests. Only the newest pending
 * request is processed; older ones are dropped. That keeps scrubbing responsive
 * and lets playback skip frames instead of falling behind.
 */
import { VideoSampleSink, type InputVideoTrack } from 'mediabunny';
import type { Layer } from '../engine/types';
import { openAsset, toMicros } from '../media/asset';
import { drawItems } from './compose';
import { createCompositor, type Compositor } from './compositor';
import { FrameReader } from './frame-reader';
import type { Lut } from './lut';
import { ReaderPool } from './reader-pool';
import { compositionSize, DEFAULT_ASPECT } from '../lib/aspect';
import type { FromWorker, ToWorker } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
}
const scope = self as unknown as WorkerScope;
const send = (message: FromWorker) => scope.postMessage(message);

let compositor: Compositor | null = null;
let canvas: OffscreenCanvas | null = null;
/** Applied when the canvas arrives, if a resize comes first. */
let size = compositionSize(DEFAULT_ASPECT);
const videoTracks = new Map<string, InputVideoTrack>();
/** One decoder per (asset, track), so the same file on two tracks doesn't thrash. */
const readers = new ReaderPool((assetId) => {
  const track = videoTracks.get(assetId);
  return track ? new FrameReader(new VideoSampleSink(track)) : null;
});
const luts = new Map<string, Lut>();
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
    case 'clearAssets':
      videoTracks.clear();
      void readers.clear();
      break;
    case 'setLuts':
      luts.clear();
      for (const { id, size, data } of message.luts) luts.set(id, { size, data });
      void drain(); // redraw with the new LUTs
      break;
    case 'resize':
      size = { width: message.width, height: message.height };
      if (canvas) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      // The main thread asks for a fresh frame after resizing.
      break;
    case 'render':
      pending = { requestId: message.requestId, layers: message.layers };
      void drain();
      break;
  }
};

async function init(target: OffscreenCanvas) {
  canvas = target;
  canvas.width = size.width;
  canvas.height = size.height;
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
    // Re-adding an asset (relink) replaces its decoders.
    void readers.removeAsset(id);
    if (video) videoTracks.set(id, video);
    else videoTracks.delete(id);
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
      compositor.draw(await drawItems(layers, readers, luts));
      send({ type: 'rendered', requestId, ms: performance.now() - started });
    }
  } catch (error) {
    send({ type: 'error', message: String(error) });
  } finally {
    rendering = false;
  }
}
