/**
 * Turn word-timed speech recognition into captions people can read.
 *
 * Whisper gives each word with its time (seconds). Captions are built from
 * those words: at most two lines of ~42 characters (a common subtitle
 * guideline) and 6 seconds, starting afresh after a pause or at a sentence
 * end, never overlapping, inside the timeline, and on screen long enough to
 * read. Each caption keeps its words' timings, relative to its own start, for
 * word-by-word highlighting. Sound tags like "[Music]" are dropped.
 */

/** A recognised word; `end` may be missing (the last word of a block). */
export interface TimedText {
  text: string;
  start: number;
  end: number | null;
}

export interface Caption {
  /** One or two lines, joined by "\n". */
  text: string;
  startUs: number;
  endUs: number;
  /** One per whitespace-separated word of `text`, relative to `startUs`. */
  words: { start: number; end: number }[];
}

export const CAPTION_LIMITS = {
  lineChars: 42,
  lines: 2,
  maxDurationUs: 6_000_000,
  /** Shorter captions are stretched (into silence only) so they can be read. */
  minDurationUs: 700_000,
  /** A pause this long starts a new caption. */
  pauseUs: 1_000_000,
  /** How long a caption stays up after its last word, if nothing follows. */
  holdUs: 500_000,
} as const;

const US = 1_000_000;

interface Word {
  text: string;
  startUs: number;
  endUs: number;
}

/**
 * Clean recognised words: drop sound tags ("[Music]", "(upbeat music)" even
 * when split over several words, "♪"), trim, split any word holding a space,
 * and fill missing end times from the next word.
 */
export function cleanWords(words: readonly TimedText[]): Word[] {
  const result: Word[] = [];
  let depth = 0; // inside [...] or (...)
  words.forEach((word, i) => {
    let text = '';
    for (const char of word.text) {
      if (char === '[' || char === '(') depth++;
      else if ((char === ']' || char === ')') && depth > 0) depth--;
      else if (depth === 0 && char !== '♪') text += char;
    }
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    const startUs = Math.max(0, Math.round(word.start * US));
    const next = words[i + 1]?.start;
    const endUs = Math.round((word.end ?? next ?? word.start + 0.3) * US);
    const step = Math.max(0, endUs - startUs) / parts.length;
    parts.forEach((part, k) =>
      result.push({
        text: part,
        startUs: Math.round(startUs + step * k),
        endUs: Math.round(startUs + step * (k + 1)),
      }),
    );
  });
  return result;
}

/** Wrap a caption into at most two lines, breaking at the space nearest the middle. */
export function wrapLines(text: string, lineChars = CAPTION_LIMITS.lineChars): string {
  if (text.length <= lineChars) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) {
    if (best < 0 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** Recognised words to captions, within a timeline `durationUs` long. */
export function captionsFromWords(input: readonly TimedText[], durationUs: number): Caption[] {
  const words = cleanWords(input).sort((a, b) => a.startUs - b.startUs);
  const maxChars = CAPTION_LIMITS.lineChars * CAPTION_LIMITS.lines;

  // Group words into captions.
  const groups: Word[][] = [];
  let group: Word[] = [];
  const length = (g: Word[]) => g.reduce((n, w) => n + w.text.length, 0) + g.length - 1;
  for (const word of words) {
    const last = group.at(-1);
    const startNew =
      last !== undefined &&
      (length([...group, word]) > maxChars ||
        word.endUs - group[0]!.startUs > CAPTION_LIMITS.maxDurationUs ||
        word.startUs - last.endUs >= CAPTION_LIMITS.pauseUs ||
        (/[.!?]$/.test(last.text) && length(group) >= maxChars / 3));
    if (startNew) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length > 0) groups.push(group);

  // Time them: from the first word, held a little after the last, readable,
  // never overlapping the next, inside the timeline.
  const captions: Caption[] = [];
  groups.forEach((g, i) => {
    const previousEnd = captions.at(-1)?.endUs ?? 0;
    const startUs = Math.max(g[0]!.startUs, previousEnd);
    const nextStart = groups[i + 1]?.[0]!.startUs ?? durationUs;
    const lastEnd = g.at(-1)!.endUs;
    const wanted = Math.max(
      lastEnd + CAPTION_LIMITS.holdUs,
      startUs + CAPTION_LIMITS.minDurationUs,
    );
    const endUs = Math.min(wanted, Math.max(lastEnd, nextStart), durationUs);
    if (endUs - startUs < 10_000) return;
    captions.push({
      text: wrapLines(g.map((w) => w.text).join(' ')),
      startUs,
      endUs,
      words: g.map((w) => ({
        start: Math.max(0, w.startUs - startUs),
        end: Math.max(0, w.endUs - startUs),
      })),
    });
  });
  return captions;
}
