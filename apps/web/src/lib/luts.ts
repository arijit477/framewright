import type { TimelineSnapshot } from '../engine/types';

/** How many clips use each LUT (LUTs no clip uses are absent). */
export function lutUsage(timeline: TimelineSnapshot): Map<string, number> {
  const usage = new Map<string, number>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.lut) usage.set(clip.lut.lutId, (usage.get(clip.lut.lutId) ?? 0) + 1);
    }
  }
  return usage;
}

export const MAX_LUT_NAME_LENGTH = 100;

/** A LUT name as stored: trimmed, single spaces, capped; null if nothing is left. */
export function cleanLutName(name: string): string | null {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_LUT_NAME_LENGTH).trim();
  return cleaned || null;
}

/** Bytes a stored LUT takes in the project (its base64 data). */
export const storedLutBytes = (data: string): number => data.length;
