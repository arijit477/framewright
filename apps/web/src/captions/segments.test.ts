import { describe, expect, it } from 'vitest';
import {
  CAPTION_LIMITS,
  cleanText,
  splitEvenly,
  splitText,
  toCaptions,
  wrapLines,
} from './segments';

const S = 1_000_000;

describe('cleaning and shaping text', () => {
  it('drops sound tags and tidies spaces', () => {
    expect(cleanText(' [Music]  Hello   (laughs) there ♪ ')).toBe('Hello there');
    expect(cleanText('[BLANK_AUDIO]')).toBe('');
  });

  it('splits long text at words, preferring sentence ends', () => {
    const long = 'word '.repeat(40).trim(); // 199 characters
    const pieces = splitText(long);
    expect(pieces.every((p) => p.length <= 84)).toBe(true);
    expect(pieces.join(' ')).toBe(long);
    expect(splitText('This is the first sentence here. And the second one.')).toEqual([
      'This is the first sentence here.',
      'And the second one.',
    ]);
  });

  it('wraps into two lines near the middle, leaving short text alone', () => {
    expect(wrapLines('Short line')).toBe('Short line');
    const wrapped = wrapLines('ask not what your country can do for you, ask what you can do');
    expect(wrapped.split('\n')).toHaveLength(2);
    expect(wrapped.split('\n').every((l) => l.length <= CAPTION_LIMITS.lineChars)).toBe(true);
  });
});

describe('toCaptions', () => {
  it('converts seconds to timeline time and keeps the text', () => {
    expect(toCaptions([{ text: ' Hello world.', start: 1, end: 2.5 }], 10 * S)).toEqual([
      { text: 'Hello world.', startUs: S, endUs: 2.5 * S },
    ]);
  });

  it('shares a long phrase between captions by length, in order', () => {
    const text = `${'a'.repeat(40)} ${'b'.repeat(40)} ${'c'.repeat(40)}`;
    const captions = toCaptions([{ text, start: 0, end: 12 }], 20 * S);
    expect(captions).toHaveLength(2);
    expect(captions[0]!.startUs).toBe(0);
    expect(captions[0]!.endUs).toBe(captions[1]!.startUs);
    expect(captions.at(-1)!.endUs).toBe(12 * S);
  });

  it('never overlaps, stays in the timeline, and makes short captions readable', () => {
    const captions = toCaptions(
      [
        { text: 'One.', start: 0, end: 0.1 }, // too short: stretched into the silence after it
        { text: 'Two.', start: 2, end: 3.5 },
        { text: 'Three.', start: 3.2, end: 4 }, // starts before Two ends
        { text: 'Four.', start: 9.5, end: null }, // no end: estimated, cut at the timeline's end
      ],
      10 * S,
    );
    expect(captions.map((c) => c.text)).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
    expect(captions[0]!.endUs).toBe(CAPTION_LIMITS.minDurationUs);
    for (let i = 1; i < captions.length; i++) {
      expect(captions[i]!.startUs).toBeGreaterThanOrEqual(captions[i - 1]!.endUs);
    }
    expect(captions.at(-1)!.endUs).toBeLessThanOrEqual(10 * S);
  });

  it('splits slow speech so no caption stays up longer than the maximum', () => {
    const text = 'And so my fellow Americans ask not what your country can do for you';
    const captions = toCaptions([{ text, start: 0, end: 15 }], 20 * S);
    expect(captions).toHaveLength(3);
    for (const c of captions) {
      expect(c.endUs - c.startUs).toBeLessThanOrEqual(CAPTION_LIMITS.maxDurationUs);
    }
    expect(captions.map((c) => c.text.replace('\n', ' ')).join(' ')).toBe(text);
  });

  it('splits evenly at words, never into empty pieces', () => {
    expect(splitEvenly('one two three four five six', 3)).toEqual([
      'one two',
      'three four',
      'five six',
    ]);
    expect(splitEvenly('just two', 5)).toEqual(['just', 'two']);
  });

  it('skips phrases that are only sound tags', () => {
    expect(toCaptions([{ text: '[Music]', start: 0, end: 5 }], 10 * S)).toEqual([]);
  });
});
