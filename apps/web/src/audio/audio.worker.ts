/**
 * Audio worker: keeps the shared ring buffer about LEAD_SECONDS ahead of the
 * AudioWorklet using the shared Mixer, and computes waveform peaks for the
 * timeline.
 */
import { AudioSampleSink, type InputAudioTrack } from 'mediabunny';
import { openAsset } from '../media/asset';
import { Mixer } from './mixer';
import { PEAKS_PER_SECOND, type FromAudioWorker, type ToAudioWorker } from './protocol';
import { RingWriter } from './ring-buffer';
import { streamsFrom } from './source-stream';

const LEAD_SECONDS = 0.25;
const CHUNK_FRAMES = 1024;

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToAudioWorker>) => void) | null;
  postMessage(message: FromAudioWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;
const send = (message: FromAudioWorker, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

const tracks = new Map<string, InputAudioTrack>();
let ring: RingWriter | null = null;
let mixer: Mixer | null = null;
let sampleRate = 48_000;
let epoch = 0;
let playing = false;

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      ring = new RingWriter(message.buffers);
      sampleRate = message.sampleRate;
      mixer = new Mixer(streamsFrom(tracks, sampleRate), sampleRate, CHUNK_FRAMES);
      break;
    case 'addAsset':
      void addAsset(message.id, message.file);
      break;
    case 'start':
      mixer?.setSegments(message.segments);
      restartAt(message.fromUs, message.epoch);
      break;
    case 'update':
      mixer?.setSegments(message.segments);
      // Re-mix from what is audible right now so the edit is heard immediately.
      if (playing && ring) restartAt(ring.playingTimeUs(sampleRate), message.epoch);
      break;
    case 'stop':
      playing = false;
      if (mixer && ring) {
        ring.flushAndAnchor(mixer.positionUs, epoch);
        mixer.dispose();
      }
      break;
  }
};

function restartAt(timeUs: number, nextEpoch: number) {
  if (!ring || !mixer) return;
  epoch = nextEpoch;
  mixer.seek(timeUs);
  ring.flushAndAnchor(timeUs, epoch);
  if (!playing) {
    playing = true;
    void pump();
  }
}

async function addAsset(id: string, file: File) {
  try {
    // If the video can't be decoded the render worker reports it; treat as no audio here.
    const { audio, durationUs } = await openAsset(file).catch(() => ({
      audio: null,
      durationUs: 0,
    }));
    if (!audio) {
      send({ type: 'assetReady', id, hasAudio: false, durationUs });
      return;
    }
    tracks.set(id, audio);
    const audioDurationUs = Math.round((await audio.computeDuration()) * 1_000_000);
    send({ type: 'assetReady', id, hasAudio: true, durationUs: audioDurationUs });
    void computePeaks(id, audio, audioDurationUs);
  } catch (error) {
    send({
      type: 'assetError',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Keep the ring buffer filled while playing. */
async function pump() {
  while (playing && ring && mixer) {
    if (ring.buffered() >= LEAD_SECONDS * sampleRate || ring.free() < CHUNK_FRAMES) {
      await sleep(5);
      continue;
    }
    let fresh: boolean;
    try {
      fresh = await mixer.next();
    } catch (error) {
      // Never let one bad file stop playback: emit silence for this chunk.
      send({ type: 'error', message: String(error) });
      mixer.left.fill(0);
      mixer.right.fill(0);
      fresh = true;
    }
    if (fresh && playing) ring.write(mixer.left, mixer.right, CHUNK_FRAMES);
  }
}

/** Max absolute amplitude per 1/PEAKS_PER_SECOND bucket, for drawing waveforms. */
async function computePeaks(id: string, track: InputAudioTrack, durationUs: number) {
  const peaks = new Float32Array(Math.ceil((durationUs / 1_000_000) * PEAKS_PER_SECOND) + 1);
  const sink = new AudioSampleSink(track);
  for await (const sample of sink.samples()) {
    try {
      const n = sample.numberOfFrames;
      const channel = new Float32Array(n);
      for (let c = 0; c < Math.min(2, sample.numberOfChannels); c++) {
        sample.copyTo(channel, { planeIndex: c, format: 'f32-planar' });
        for (let i = 0; i < n; i++) {
          const bucket = Math.floor((sample.timestamp + i / sample.sampleRate) * PEAKS_PER_SECOND);
          const v = Math.abs(channel[i]!);
          if (bucket >= 0 && bucket < peaks.length && v > peaks[bucket]!) peaks[bucket] = v;
        }
      }
    } finally {
      sample.close();
    }
  }
  send({ type: 'peaks', id, peaks }, [peaks.buffer]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
