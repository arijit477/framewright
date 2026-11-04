import type { AudioFade, AudioSegment } from '../engine/types';

/**
 * Gain of a fade at a timeline time: 0 before a fade-in and 1 after it, the
 * reverse for a fade-out.
 *
 * Equal-power curves (sin/cos) keep the summed loudness of a crossfade
 * constant, since sin² + cos² = 1 for uncorrelated sources; a linear ramp
 * would dip by 3 dB in the middle. Dips use linear ramps, which sound natural
 * when only one side is playing.
 */
export function fadeGain(fade: AudioFade, direction: 'in' | 'out', timeUs: number): number {
  const length = fade.end - fade.start;
  const progress = length <= 0 ? 1 : Math.min(1, Math.max(0, (timeUs - fade.start) / length));
  const p = direction === 'in' ? progress : 1 - progress;
  return fade.curve === 'equalPower' ? Math.sin((p * Math.PI) / 2) : p;
}

/** Combined fade gain of a segment at a timeline time (1 when it has no fades). */
export function segmentFade(segment: AudioSegment, timeUs: number): number {
  let gain = 1;
  if (segment.fadeIn) gain *= fadeGain(segment.fadeIn, 'in', timeUs);
  if (segment.fadeOut) gain *= fadeGain(segment.fadeOut, 'out', timeUs);
  return gain;
}

/** Whether any fade on the segment overlaps the time range [from, to). */
export function fadesOverlap(segment: AudioSegment, fromUs: number, toUs: number): boolean {
  const overlaps = (fade?: AudioFade) => !!fade && fade.start < toUs && fade.end > fromUs;
  return overlaps(segment.fadeIn) || overlaps(segment.fadeOut);
}
