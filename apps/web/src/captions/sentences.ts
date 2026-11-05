/**
 * Sentence-level caption translation. Captions often split a sentence ("…ask
 * not what your | country can do for you…"), and translating the halves
 * separately loses the grammar. So neighbouring captions are grouped into
 * sentences, each sentence is translated whole, and the translation is shared
 * back out over the captions in proportion to how much of the original each
 * held, cutting at punctuation where that's close. Every caption keeps its time.
 */
import { oneLine } from './translation';

export interface TimedCue {
  text: string;
  startUs: number;
  endUs: number;
}

export const SENTENCE_LIMITS = {
  /** A pause at least this long between captions ends a sentence. */
  pauseUs: 1_000_000,
  /** Keeps model inputs short (OPUS-MT works best on single sentences). */
  maxCaptions: 4,
  maxChars: 300,
} as const;

/** Ends a sentence: . ! ? … (and the CJK forms), optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?…。！？]["'”’»)\]]*$/;

/** Indices of `cues` (in time order) grouped into sentences, in order. */
export function sentenceGroups(cues: readonly TimedCue[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    chars = 0;
  };
  cues.forEach((cue, i) => {
    const text = oneLine(cue.text);
    const previous = current.length ? cues[current[current.length - 1]!]! : null;
    if (
      previous &&
      (cue.startUs - previous.endUs >= SENTENCE_LIMITS.pauseUs ||
        current.length >= SENTENCE_LIMITS.maxCaptions ||
        chars + text.length > SENTENCE_LIMITS.maxChars)
    ) {
      flush();
    }
    current.push(i);
    chars += text.length + 1;
    if (SENTENCE_END.test(text)) flush();
  });
  flush();
  return groups;
}

/** Languages written without spaces between words: translations are cut between characters. */
export const UNSPACED_LANGUAGES = new Set(['zh', 'ja', 'th']);

/** Punctuation it reads well to cut after. */
const BREAK_AFTER = /[,;:、，；：。！？.!?…)\]”’»-]$/;
/** How much (as a fraction of the sentence) a cut may move to land after punctuation. */
const PUNCTUATION_PULL = 0.08;

/**
 * Share `text` over captions in proportion to `weights` (each caption's share
 * of the original, e.g. its length). Every part gets at least one word (or
 * character) when there are enough; parts are never empty.
 */
export function distribute(text: string, weights: readonly number[], spaced = true): string[] {
  const n = weights.length;
  const clean = oneLine(text);
  if (n <= 1) return [clean];
  const tokens = spaced ? clean.split(' ').filter(Boolean) : Array.from(clean.replace(/ /g, ''));
  const join = (parts: string[]) => parts.join(spaced ? ' ' : '');
  if (tokens.length < n) {
    // Too few words to share: the first captions get one each, the rest an ellipsis.
    return weights.map((_, i) => tokens[i] ?? '…');
  }
  // Character position (including separators) at the end of each token.
  const ends: number[] = [];
  let position = 0;
  for (const token of tokens) {
    position += Array.from(token).length + (spaced && ends.length ? 1 : 0);
    ends.push(position);
  }
  const total = position;
  // Without usable weights, share evenly.
  const shares = weights.every((w) => !(w > 0))
    ? weights.map(() => 1)
    : weights.map((w) => Math.max(0, w));
  const weightSum = shares.reduce((a, b) => a + b, 0);
  const cuts: number[] = []; // part k ends after token cuts[k]
  let cumulative = 0;
  let previous = -1;
  for (let k = 0; k < n - 1; k++) {
    cumulative += shares[k]!;
    const target = (total * cumulative) / weightSum;
    // Leave at least one token for each remaining part.
    const last = tokens.length - (n - k);
    let best = previous + 1;
    let bestScore = Infinity;
    for (let t = previous + 1; t <= last; t++) {
      const score =
        Math.abs(ends[t]! - target) / total - (BREAK_AFTER.test(tokens[t]!) ? PUNCTUATION_PULL : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    cuts.push(best);
    previous = best;
  }
  const parts: string[] = [];
  let from = 0;
  for (const cut of [...cuts, tokens.length - 1]) {
    parts.push(join(tokens.slice(from, cut + 1)));
    from = cut + 1;
  }
  return parts;
}

/** What to translate: one input per sentence, from captions in time order. */
export function sentenceInputs(cues: readonly TimedCue[]): { groups: number[][]; texts: string[] } {
  const groups = sentenceGroups(cues);
  return {
    groups,
    texts: groups.map((g) => g.map((i) => oneLine(cues[i]!.text)).join(' ')),
  };
}

/** Each caption's share of its sentence's translation (one text per cue, in order). */
export function captionTranslations(
  cues: readonly TimedCue[],
  groups: readonly number[][],
  translations: readonly string[],
  targetLanguage: string,
): string[] {
  const out: string[] = new Array<string>(cues.length);
  const spaced = !UNSPACED_LANGUAGES.has(targetLanguage);
  groups.forEach((group, g) => {
    const weights = group.map((i) => Array.from(oneLine(cues[i]!.text)).length);
    distribute(translations[g] ?? '', weights, spaced).forEach((part, k) => {
      out[group[k]!] = part;
    });
  });
  return out;
}
