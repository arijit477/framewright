/**
 * Split long audio into blocks for recognition (so progress can be shown),
 * cutting in the quietest moment near each nominal boundary so no word is
 * chopped in half.
 */
export function blockBoundaries(
  samples: Float32Array,
  rate: number,
  blockSeconds = 120,
  searchSeconds = 5,
): number[] {
  const block = Math.round(blockSeconds * rate);
  const search = Math.round(searchSeconds * rate);
  const window = Math.round(0.05 * rate); // 50 ms of loudness at a time
  const boundaries = [0];
  while (samples.length - boundaries.at(-1)! > block + search) {
    const nominal = boundaries.at(-1)! + block;
    let quietest = nominal;
    let lowest = Infinity;
    for (let at = nominal - search; at + window <= nominal + search; at += window) {
      let energy = 0;
      for (let i = at; i < at + window; i++) energy += samples[i]! * samples[i]!;
      if (energy < lowest) {
        lowest = energy;
        quietest = at + Math.floor(window / 2);
      }
    }
    boundaries.push(quietest);
  }
  boundaries.push(samples.length);
  return boundaries;
}

/** About -60 dBFS: quieter than any speech worth captioning. */
export const SILENCE_PEAK = 0.001;

/**
 * Whether audio is effectively silent. Whisper "hears" words in silence (a
 * well-known quirk: "you", "Thank you."), so silent blocks are skipped.
 */
export function isSilent(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > SILENCE_PEAK) return false;
  }
  return true;
}
