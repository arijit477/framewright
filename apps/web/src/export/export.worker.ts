/**
 * Export worker: renders a project snapshot to an MP4/WebM file, faster than
 * real time, with the same building blocks as the live preview:
 *
 *   TimelineEngine.resolve(t) -> FrameReader (decode) -> Compositor (draw)
 *     -> CanvasSource (WebCodecs VideoEncoder)
 *   TimelineEngine.audioSegments() -> Mixer -> AudioSampleSource (AudioEncoder)
 *     -> mediabunny muxer -> file
 *
 * One worker per export: it's terminated when done, so decoders and encoder
 * memory are always released, even after an error.
 */
import {
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  WebMOutputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import { Mixer } from '../audio/mixer';
import { streamsFrom } from '../audio/source-stream';
import { TimelineEngine } from '../engine/engine';
import { openAsset } from '../media/asset';
import { drawItems } from '../render/compose';
import type { Lut } from '../render/lut';
import type { LutData } from '../render/protocol';
import { createCompositor } from '../render/compositor';
import { FrameReader } from '../render/frame-reader';
import { ReaderPool } from '../render/reader-pool';
import type { ExportAsset, ExportDestination, FromExportWorker, ToExportWorker } from './protocol';
import { openSink, type ExportSink } from './sink';
import {
  AUDIO_CODECS,
  audioBitrate,
  EXPORT_SAMPLE_RATE,
  FORMATS,
  frameTimeUs,
  maximumPacketCounts,
  outputSize,
  totalFrames,
  VIDEO_CODECS,
  videoBitrate,
  type ExportSettings,
} from './settings';

const AUDIO_CHUNK_FRAMES = 4096;
const PROGRESS_INTERVAL_MS = 200;
const KEYFRAME_INTERVAL_S = 2;

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToExportWorker>) => void) | null;
  postMessage(message: FromExportWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
const send = (message: FromExportWorker, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

let cancelled = false;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'cancel') cancelled = true;
  if (message.type === 'start') {
    run(
      message.projectJson,
      message.assets,
      message.luts,
      message.settings,
      message.destination,
    ).catch((error: unknown) => {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
  }
};

class Cancelled extends Error {}

async function run(
  projectJson: string,
  assets: ExportAsset[],
  lutList: LutData[],
  settings: ExportSettings,
  destination: ExportDestination,
) {
  const startedAt = performance.now();
  const warnings: string[] = [];
  const engine = await TimelineEngine.fromJson(projectJson);
  const luts = new Map<string, Lut>(lutList.map(({ id, size, data }) => [id, { size, data }]));
  const videoTracks = new Map<string, InputVideoTrack>();
  const readers = new ReaderPool((assetId) => {
    const track = videoTracks.get(assetId);
    return track ? new FrameReader(new VideoSampleSink(track)) : null;
  });
  const audioTracks = new Map<string, InputAudioTrack>();
  let mixer: Mixer | null = null;
  let output: Output | null = null;
  let sink: ExportSink | null = null;

  try {
    const durationUs = engine.duration();
    if (durationUs <= 0) throw new Error('The timeline is empty.');

    // Open every asset the project uses.
    for (const { id, file } of assets) {
      const { video, audio } = await openAsset(file);
      if (video) videoTracks.set(id, video);
      if (audio) audioTracks.set(id, audio);
    }

    // Pick codecs this browser can actually encode at these settings.
    const { width, height } = outputSize(settings);
    const videoCodec = await getFirstEncodableVideoCodec(VIDEO_CODECS[settings.format], {
      width,
      height,
      bitrate: videoBitrate(settings),
      frameRate: settings.fps,
    });
    if (!videoCodec) {
      throw new Error(
        `This browser can't encode ${settings.format.toUpperCase()} video at ${width}×${height}. ` +
          'Try the other format or a lower resolution.',
      );
    }
    const segments = engine.audioSegments().filter((s) => audioTracks.has(s.assetId));
    let audioCodec = null;
    if (segments.length > 0) {
      audioCodec = await getFirstEncodableAudioCodec(AUDIO_CODECS[settings.format], {
        numberOfChannels: 2,
        sampleRate: EXPORT_SAMPLE_RATE,
        bitrate: audioBitrate(settings),
      });
      if (!audioCodec)
        warnings.push('This browser cannot encode audio for this format; the export is silent.');
    }

    // Wire up the output file.
    const canvas = new OffscreenCanvas(width, height);
    const compositor = await createCompositor(canvas, { backend: 'canvas2d' });
    sink = await openSink(
      destination,
      `${crypto.randomUUID()}.${FORMATS[settings.format].extension}`,
    );
    output = new Output({
      format:
        settings.format === 'mp4'
          ? // Streamed files reserve room for the index up front, so they keep fast start
            // without holding the media in memory.
            new Mp4OutputFormat({ fastStart: sink.streaming ? 'reserve' : 'in-memory' })
          : new WebMOutputFormat(),
      target: sink.target,
    });
    const packetLimits = maximumPacketCounts(durationUs, settings.fps);
    const videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: videoBitrate(settings),
      keyFrameInterval: KEYFRAME_INTERVAL_S,
    });
    output.addVideoTrack(videoSource, {
      frameRate: settings.fps,
      maximumPacketCount: packetLimits.video,
    });

    let audioSource: AudioSampleSource | null = null;
    if (audioCodec) {
      audioSource = new AudioSampleSource({ codec: audioCodec, bitrate: audioBitrate(settings) });
      output.addAudioTrack(audioSource, { maximumPacketCount: packetLimits.audio });
      mixer = new Mixer(
        streamsFrom(audioTracks, EXPORT_SAMPLE_RATE),
        EXPORT_SAMPLE_RATE,
        AUDIO_CHUNK_FRAMES,
      );
      mixer.setSegments(segments);
      mixer.seek(0);
    }
    await output.start();

    const frames = totalFrames(durationUs, settings.fps);
    const audioFramesTotal = Math.round((durationUs * EXPORT_SAMPLE_RATE) / 1_000_000);
    let audioFramesDone = 0;
    let lastProgress = 0;

    for (let i = 0; i < frames; i++) {
      if (cancelled) throw new Cancelled();

      // Video: resolve the layers, decode, composite, encode.
      const layers = engine.resolve(frameTimeUs(i, settings.fps));
      compositor.draw(await drawItems(layers, readers, luts));
      await videoSource.add(i / settings.fps, 1 / settings.fps);

      // Audio: keep it level with the video so the muxer can interleave.
      if (audioSource && mixer) {
        const audioTarget = Math.min(
          audioFramesTotal,
          Math.round((frameTimeUs(i + 1, settings.fps) * EXPORT_SAMPLE_RATE) / 1_000_000),
        );
        while (audioFramesDone < audioTarget) {
          await mixer.next();
          const n = Math.min(AUDIO_CHUNK_FRAMES, audioFramesTotal - audioFramesDone);
          const planar = new Float32Array(n * 2);
          planar.set(mixer.left.subarray(0, n), 0);
          planar.set(mixer.right.subarray(0, n), n);
          const sample = new AudioSample({
            data: planar,
            format: 'f32-planar',
            numberOfChannels: 2,
            sampleRate: EXPORT_SAMPLE_RATE,
            timestamp: audioFramesDone / EXPORT_SAMPLE_RATE,
          });
          try {
            await audioSource.add(sample);
          } finally {
            sample.close();
          }
          audioFramesDone += n;
        }
      }

      const now = performance.now();
      if (now - lastProgress > PROGRESS_INTERVAL_MS || i === frames - 1) {
        lastProgress = now;
        send({
          type: 'progress',
          framesDone: i + 1,
          totalFrames: frames,
          elapsedMs: now - startedAt,
        });
      }
    }

    await output.finalize();
    const result = await sink.finish();
    send(
      {
        type: 'done',
        output: result,
        mimeType: await output.getMimeType(),
        videoCodec,
        audioCodec,
        frames,
        elapsedMs: performance.now() - startedAt,
        warnings,
      },
      result.kind === 'memory' ? [result.buffer] : [],
    );
  } catch (error) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    // Never leave a partial file behind.
    await sink?.abort();
    if (error instanceof Cancelled) {
      send({ type: 'cancelled' });
      return;
    }
    throw error;
  } finally {
    mixer?.dispose();
    await readers.clear();
    engine.free();
  }
}
