/**
 * Silence worker: plays each clip's sound on its own, with the same mixer as
 * playback (so speed changes and the clip's source range are exactly as
 * heard), and finds its quiet stretches. Volume and fades are left out: they
 * shape the mix, not where the speaker paused.
 */
import type { InputAudioTrack } from 'mediabunny';
import { Mixer } from '../audio/mixer';
import { streamsFrom } from '../audio/source-stream';
import { TimelineEngine } from '../engine/engine';
import { openAsset } from '../media/asset';
import { loudness, silentRanges, WINDOW_US } from './detect';
import type { FromSilenceWorker, ToSilenceWorker } from './protocol';

/** Plenty for loudness (speech energy is well below 8 kHz). */
const RATE = 16_000;

const send = (message: FromSilenceWorker) => self.postMessage(message);

self.onmessage = (event: MessageEvent<ToSilenceWorker>) => {
  run(event.data).catch((error: unknown) =>
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  );
};

async function run({ projectJson, assets, clipIds, options }: ToSilenceWorker) {
  const engine = await TimelineEngine.fromJson(projectJson);
  const tracks = new Map<string, InputAudioTrack>();
  for (const { id, file } of assets) {
    const { audio } = await openAsset(file);
    if (audio) tracks.set(id, audio);
  }
  const segments = engine.audioSegments().filter((s) => clipIds.includes(s.clipId));
  const total = segments.reduce((sum, s) => sum + s.duration, 0) || 1;
  let done = 0;
  const silences: { clipId: number; ranges: [number, number][] }[] = [];
  for (const segment of segments) {
    if (!tracks.has(segment.assetId)) continue;
    const chunk = RATE; // one second at a time
    const frames = Math.ceil((segment.duration / 1e6) * RATE);
    const mono = new Float32Array(frames);
    const mixer = new Mixer(streamsFrom(tracks, RATE), RATE, chunk);
    mixer.setSegments([{ ...segment, gain: 1, fadeIn: undefined, fadeOut: undefined }]);
    mixer.seek(segment.start);
    for (let at = 0; at < frames; at += chunk) {
      await mixer.next();
      const n = Math.min(chunk, frames - at);
      for (let i = 0; i < n; i++) mono[at + i] = (mixer.left[i]! + mixer.right[i]!) / 2;
      send({ type: 'progress', fraction: (done + ((at + n) / frames) * segment.duration) / total });
    }
    mixer.dispose();
    done += segment.duration;
    const db = loudness(mono, (RATE * WINDOW_US) / 1e6);
    silences.push({
      clipId: segment.clipId,
      ranges: silentRanges(db, segment.duration, options).map(([a, b]) => [
        segment.start + a,
        segment.start + b,
      ]),
    });
  }
  send({ type: 'done', silences });
}
