/**
 * Turn speech-recognition output into captions people can read.
 *
 * Whisper gives timed phrases (seconds). Captions need to be short (at most
 * two lines of ~42 characters, a common subtitle guideline), on screen long
 * enough to read, never overlapping, and inside the timeline. Long phrases
 * are split at word boundaries (preferring sentence ends), with the phrase's
 * time shared out by length; sound tags like "[Music]" are dropped.
 */

/** A phrase as the recogniser reports it; `end` may be missing for the last one. */
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
}

export const CAPTION_LIMITS = {
  lineChars: 42,
  lines: 2,
  /** Shorter captions are stretched (into silence only) so they can be read. */
  minDurationUs: 700_000,
  /** Longer ones are split, so text keeps up with the speech. */
  maxDurationUs: 6_000_000,
  /** Reading speed used when the recogniser gives no end time. */
  charsPerSecond: 15,
} as const;

const US = 1_000_000;

/** Remove sound tags ("[Music]", "(laughs)") and tidy spacing. */
export function cleanText(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split text into pieces that fit one caption, at word boundaries, preferring sentence ends. */
export function splitText(
  text: string,
  maxChars = CAPTION_LIMITS.lineChars * CAPTION_LIMITS.lines,
): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      pieces.push(current);
      current = word;
    } else {
      current = next;
    }
    // A sentence ends here and the caption already has some substance: start a new one.
    if (/[.!?]$/.test(current) && current.length >= maxChars / 3) {
      pieces.push(current);
      current = '';
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Split text at word boundaries into `count` pieces of about equal length. */
export function splitEvenly(text: string, count: number): string[] {
  const words = text.split(' ');
  const pieces = Math.min(count, words.length);
  // Where each word ends, in characters; cut at the word end nearest each 1/n of the text.
  const ends: number[] = [];
  let at = 0;
  for (const word of words) ends.push((at += word.length + 1));
  const cuts: number[] = [];
  for (let k = 1; k < pieces; k++) {
    const goal = (text.length * k) / pieces;
    const earliest = (cuts.at(-1) ?? 0) + 1; // every piece keeps at least one word
    const latest = words.length - (pieces - k); // ...and leaves enough for the rest
    let best = earliest;
    for (let w = earliest; w <= latest; w++) {
      if (Math.abs(ends[w - 1]! - goal) < Math.abs(ends[best - 1]! - goal)) best = w;
    }
    cuts.push(best);
  }
  return [0, ...cuts, words.length]
    .slice(0, -1)
    .map((from, i) => words.slice(from, [...cuts, words.length][i]).join(' '));
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

/** Recognised phrases to captions, within a timeline `durationUs` long. */
export function toCaptions(phrases: readonly TimedText[], durationUs: number): Caption[] {
  const captions: Caption[] = [];
  phrases.forEach((phrase, index) => {
    const text = cleanText(phrase.text);
    if (!text) return;
    const startUs = Math.max(0, Math.round(phrase.start * US));
    const fallbackEnd = startUs + (text.length / CAPTION_LIMITS.charsPerSecond) * US;
    const nextStart = phrases[index + 1]?.start;
    const endUs = Math.round(
      phrase.end !== null && phrase.end > phrase.start
        ? phrase.end * US
        : Math.min(fallbackEnd, nextStart !== undefined ? nextStart * US : Infinity),
    );
    // Share the phrase's time between its pieces by length, with enough
    // pieces that none stays up longer than the maximum.
    const byLength = splitText(text);
    const words = text.split(' ').length;
    const needed = Math.min(words, Math.ceil((endUs - startUs) / CAPTION_LIMITS.maxDurationUs));
    const pieces = byLength.length >= needed ? byLength : splitEvenly(text, needed);
    const total = pieces.reduce((n, p) => n + p.length, 0);
    let at = startUs;
    for (const piece of pieces) {
      const length = ((endUs - startUs) * piece.length) / total;
      captions.push({
        text: wrapLines(piece),
        startUs: Math.round(at),
        endUs: Math.round(at + length),
      });
      at += length;
    }
  });

  // Inside the timeline, in order, readable, and never overlapping.
  captions.sort((a, b) => a.startUs - b.startUs);
  const result: Caption[] = [];
  captions.forEach((caption, i) => {
    const previousEnd = result.at(-1)?.endUs ?? 0;
    const nextStart = captions[i + 1]?.startUs ?? durationUs;
    const startUs = Math.max(caption.startUs, previousEnd);
    const wanted = Math.max(caption.endUs, startUs + CAPTION_LIMITS.minDurationUs);
    const endUs = Math.min(wanted, Math.max(caption.endUs, nextStart), durationUs);
    if (endUs - startUs >= 10_000) result.push({ ...caption, startUs, endUs });
  });
  return result;
}
