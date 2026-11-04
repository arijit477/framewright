import { describe, expect, it } from 'vitest';
import { CAPTION_LIMITS, captionsFromWords, cleanWords, wrapLines } from './segments';

const S = 1_000_000;

/** Words spoken one after another, 0.4 s each, from `start` seconds. */
const spoken = (text: string, start = 0, each = 0.4) =>
  text.split(' ').map((word, i) => ({
    text: ` ${word}`,
    start: start + i * each,
    end: start + (i + 1) * each,
  }));

describe('cleaning words', () => {
  it('drops sound tags, even split over words, and trims', () => {
    const words = cleanWords([
      { text: ' [Music]', start: 0, end: 1 },
      { text: ' (upbeat', start: 1, end: 1.2 },
      { text: ' music)', start: 1.2, end: 1.5 },
      { text: ' Hello', start: 2, end: 2.4 },
      { text: ' ♪', start: 2.4, end: 2.5 },
    ]);
    expect(words).toEqual([{ text: 'Hello', startUs: 2 * S, endUs: 2.4 * S }]);
  });

  it('splits a word holding a space and fills a missing end from the next word', () => {
    expect(
      cleanWords([
        { text: ' 1 000', start: 0, end: 1 },
        { text: ' people', start: 1.5, end: null },
      ]),
    ).toEqual([
      { text: '1', startUs: 0, endUs: 0.5 * S },
      { text: '000', startUs: 0.5 * S, endUs: S },
      { text: 'people', startUs: 1.5 * S, endUs: 1.8 * S },
    ]);
  });
});

describe('wrapLines', () => {
  it('wraps into two lines near the middle, leaving short text alone', () => {
    expect(wrapLines('Short line')).toBe('Short line');
    const wrapped = wrapLines('ask not what your country can do for you, ask what you can do');
    expect(wrapped.split('\n')).toHaveLength(2);
    expect(wrapped.split('\n').every((l) => l.length <= CAPTION_LIMITS.lineChars)).toBe(true);
  });
});

describe('captionsFromWords', () => {
  it('keeps each word’s timing, relative to the caption', () => {
    const [caption] = captionsFromWords(spoken('ask not what', 1), 10 * S);
    expect(caption).toEqual({
      text: 'ask not what',
      startUs: S,
      endUs: 2.2 * S + CAPTION_LIMITS.holdUs,
      words: [
        { start: 0, end: 0.4 * S },
        { start: 0.4 * S, end: 0.8 * S },
        { start: 0.8 * S, end: 1.2 * S },
      ],
    });
  });

  it('starts a new caption after a pause, at a sentence end, or when full', () => {
    const pause = captionsFromWords(
      [...spoken('first part', 0), ...spoken('after pause', 3)],
      10 * S,
    );
    expect(pause.map((c) => c.text)).toEqual(['first part', 'after pause']);

    const sentences = captionsFromWords(
      spoken('This first sentence is long enough. Then a second one.'),
      20 * S,
    );
    expect(sentences.map((c) => c.text)).toEqual([
      'This first sentence is long enough.',
      'Then a second one.',
    ]);

    const long = captionsFromWords(spoken('word '.repeat(40).trim(), 0, 0.1), 20 * S);
    expect(long.length).toBeGreaterThan(1);
    for (const c of long) {
      expect(c.text.replace('\n', ' ').length).toBeLessThanOrEqual(84);
      expect(c.text.split(/\s+/)).toHaveLength(c.words.length); // timings match the text
    }
  });

  it('never runs longer than six seconds, overlaps, or leaves the timeline', () => {
    const slow = captionsFromWords(
      spoken('one two three four five six seven eight', 0, 1.5),
      13 * S,
    );
    for (const c of slow) {
      expect(c.endUs - c.startUs).toBeLessThanOrEqual(
        CAPTION_LIMITS.maxDurationUs + CAPTION_LIMITS.holdUs,
      );
    }
    for (let i = 1; i < slow.length; i++) {
      expect(slow[i]!.startUs).toBeGreaterThanOrEqual(slow[i - 1]!.endUs);
    }
    expect(slow.at(-1)!.endUs).toBeLessThanOrEqual(13 * S);
  });

  it('makes a lone short word readable, into the silence after it', () => {
    const [caption] = captionsFromWords([{ text: ' Hi', start: 0, end: 0.1 }], 10 * S);
    expect(caption!.endUs).toBe(CAPTION_LIMITS.minDurationUs);
  });

  it('gives nothing for sound tags alone', () => {
    expect(captionsFromWords([{ text: '[Music]', start: 0, end: 5 }], 10 * S)).toEqual([]);
  });
});
