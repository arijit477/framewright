import { describe, expect, it } from 'vitest';
import {
  captionTranslations,
  distribute,
  SENTENCE_LIMITS,
  sentenceGroups,
  sentenceInputs,
  type TimedCue,
} from './sentences';

const cue = (text: string, startS: number, endS: number): TimedCue => ({
  text,
  startUs: startS * 1e6,
  endUs: endS * 1e6,
});

describe('sentenceGroups', () => {
  it('joins captions that continue a sentence, and ends at sentence punctuation', () => {
    const cues = [
      cue('And so my fellow Americans ask not what your', 0.2, 6.2),
      cue('country can do for you, ask what you can do\nfor your country.', 6.2, 11),
      cue('Thank you.', 11.2, 12),
    ];
    expect(sentenceGroups(cues)).toEqual([[0, 1], [2]]);
  });

  it('ends a sentence at a pause, even without punctuation', () => {
    const cues = [cue('so we went', 0, 1), cue('home', 1.1, 2), cue('later on', 3, 4)];
    expect(sentenceGroups(cues)).toEqual([[0, 1], [2]]);
  });

  it('keeps model inputs bounded', () => {
    const many = Array.from({ length: 10 }, (_, i) => cue('and then', i, i + 1));
    const groups = sentenceGroups(many);
    expect(groups.every((g) => g.length <= SENTENCE_LIMITS.maxCaptions)).toBe(true);
    expect(groups.flat()).toEqual([...Array(10).keys()]);
    const long = Array.from({ length: 3 }, (_, i) => cue('x'.repeat(200), i, i + 1));
    expect(sentenceGroups(long)).toEqual([[0], [1], [2]]);
  });

  it('treats closing quotes and CJK punctuation as sentence ends', () => {
    expect(sentenceGroups([cue('He said “go.”', 0, 1), cue('We went.', 1, 2)])).toEqual([[0], [1]]);
    expect(sentenceGroups([cue('我们走了。', 0, 1), cue('好', 1, 2)])).toEqual([[0], [1]]);
  });
});

describe('distribute', () => {
  it('keeps a single caption whole', () => {
    expect(distribute(' Hola  mundo ', [5])).toEqual(['Hola mundo']);
  });

  it('shares words in proportion to the original captions', () => {
    const parts = distribute('uno dos tres cuatro cinco seis siete ocho', [1, 3]);
    // A quarter of the 41 characters ends just after "tres".
    expect(parts).toEqual(['uno dos tres', 'cuatro cinco seis siete ocho']);
  });

  it('prefers to cut after punctuation when it is close', () => {
    // An even split would cut after "three"; the comma one word later wins.
    const parts = distribute('one two three four, five six seven eight', [1, 1]);
    expect(parts).toEqual(['one two three four,', 'five six seven eight']);
  });

  it('never loses or reorders words, and leaves no part empty', () => {
    const text = 'a b c d e f g h i j';
    for (const weights of [
      [1, 1, 1],
      [10, 1, 1],
      [1, 1, 10],
      [0, 0, 0],
    ]) {
      const parts = distribute(text, weights);
      expect(parts).toHaveLength(3);
      expect(parts.join(' ')).toBe(text);
      expect(parts.every((p) => p.length > 0)).toBe(true);
    }
  });

  it('cuts between characters for languages written without spaces', () => {
    const parts = distribute('我们的国家可以为你做什么', [1, 1], false);
    expect(parts.join('')).toBe('我们的国家可以为你做什么');
    expect(parts[0]).toBe('我们的国家可');
  });

  it('fills parts with an ellipsis when there are fewer words than captions', () => {
    expect(distribute('Sí', [1, 1])).toEqual(['Sí', '…']);
  });
});

describe('sentence inputs and captions', () => {
  it('translates sentences and gives every caption its share, in order', () => {
    const cues = [
      cue('And so my fellow Americans ask not what your', 0.2, 6.2),
      cue('country can do for you.', 6.2, 9),
      cue('Thank you.', 9.2, 10),
    ];
    const { groups, texts } = sentenceInputs(cues);
    expect(texts).toEqual([
      'And so my fellow Americans ask not what your country can do for you.',
      'Thank you.',
    ]);
    const parts = captionTranslations(
      cues,
      groups,
      ['Así que, mis compatriotas, no pregunten qué puede hacer su país por ustedes.', 'Gracias.'],
      'es',
    );
    expect(parts).toHaveLength(3);
    expect(`${parts[0]} ${parts[1]}`).toBe(
      'Así que, mis compatriotas, no pregunten qué puede hacer su país por ustedes.',
    );
    expect(parts[0]!.length).toBeGreaterThan(parts[1]!.length); // the first caption held more
    expect(parts[2]).toBe('Gracias.');
  });

  it('cuts Chinese between characters', () => {
    const cues = [cue('ask not what your', 0, 1), cue('country can do', 1, 2)];
    const { groups } = sentenceInputs(cues);
    const parts = captionTranslations(cues, groups, ['不要问你的国家能做什么'], 'zh');
    expect(parts.join('')).toBe('不要问你的国家能做什么');
    expect(parts.every((p) => !p.includes(' '))).toBe(true);
  });
});
