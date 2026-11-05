/**
 * Silence detection: find the quiet stretches in a clip's sound, so they can
 * be cut out. Loudness is measured in short windows; a stretch counts as
 * silence when every window in it is below a threshold for at least a minimum
 * length. A margin is kept on both sides so the start and end of words (soft
 * consonants, breaths) aren't clipped.
 */

export interface SilenceOptions {
  /** Windows quieter than this (dBFS, RMS) are silent. */
  thresholdDb: number;
  /** Shorter pauses are kept: they're part of natural speech. */
  minSilenceUs: number;
  /** Kept on each side of the sound, inside the silence. */
  marginUs: number;
}

export const DEFAULT_SILENCE: SilenceOptions = {
  thresholdDb: -40,
  minSilenceUs: 500_000,
  marginUs: 150_000,
};

/** Loudness is measured over 10 ms windows. */
export const WINDOW_US = 10_000;

/** RMS loudness (dBFS) of each `windowSamples`-long window of `samples`. */
export function loudness(samples: Float32Array, windowSamples: number): Float32Array {
  const count = Math.ceil(samples.length / windowSamples);
  const db = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    const from = w * windowSamples;
    const to = Math.min(samples.length, from + windowSamples);
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    db[w] = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }
  return db;
}

/**
 * The silent stretches to cut, as [start, end) in µs from the start of the
 * analysed sound (`durationUs` long, one loudness value per `WINDOW_US`).
 * Each has the margin taken off its ends; silence at the very start or end of
 * the sound is cut right to the edge (there's no word there to protect).
 */
export function silentRanges(
  db: Float32Array,
  durationUs: number,
  { thresholdDb, minSilenceUs, marginUs }: SilenceOptions = DEFAULT_SILENCE,
): [number, number][] {
  const ranges: [number, number][] = [];
  let runStart = -1;
  const close = (endWindow: number) => {
    const start = runStart * WINDOW_US;
    const end = Math.min(durationUs, endWindow * WINDOW_US);
    runStart = -1;
    if (end - start < minSilenceUs) return;
    const from = start === 0 ? 0 : start + marginUs;
    const to = end >= durationUs ? durationUs : end - marginUs;
    if (to > from) ranges.push([from, to]);
  };
  for (let w = 0; w < db.length; w++) {
    const silent = db[w]! < thresholdDb;
    if (silent && runStart < 0) runStart = w;
    if (!silent && runStart >= 0) close(w);
  }
  if (runStart >= 0) close(db.length);
  return ranges;
}
