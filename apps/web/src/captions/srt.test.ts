import { describe, expect, it } from 'vitest';
import { combineCues, formatCaptionTime, toSrt, toVtt } from './srt';

const captions = [
  { text: 'Hello there.', startUs: 1_500_000, endUs: 3_000_000 },
  { text: 'Two\nlines', startUs: 3_723_456_000, endUs: 3_725_000_000 },
];

describe('caption files', () => {
  it('formats times to the millisecond', () => {
    expect(formatCaptionTime(3_723_456_789, ',')).toBe('01:02:03,457');
    expect(formatCaptionTime(0, '.')).toBe('00:00:00.000');
  });

  it('writes SubRip', () => {
    expect(toSrt(captions)).toBe(
      '1\n00:00:01,500 --> 00:00:03,000\nHello there.\n\n' +
        '2\n01:02:03,456 --> 01:02:05,000\nTwo\nlines\n',
    );
  });

  it('writes WebVTT', () => {
    expect(toVtt(captions)).toBe(
      'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello there.\n\n' +
        '01:02:03.456 --> 01:02:05.000\nTwo\nlines\n',
    );
  });
});

describe('combineCues (bilingual files)', () => {
  const cue = (text: string, startS: number, endS: number) => ({
    text,
    startUs: startS * 1e6,
    endUs: endS * 1e6,
  });

  it('pairs cues with the same times, first language on top', () => {
    const english = [cue('And so my fellow Americans', 0.2, 6.2), cue('ask not.', 6.2, 11)];
    const spanish = [cue('Y así, compatriotas', 0.2, 6.2), cue('no pregunten.', 6.2, 11)];
    expect(toSrt(combineCues(english, spanish))).toBe(
      '1\n00:00:00,200 --> 00:00:06,200\nAnd so my fellow Americans\nY así, compatriotas\n\n' +
        '2\n00:00:06,200 --> 00:00:11,000\nask not.\nno pregunten.\n',
    );
  });

  it('pairs by time even when the second track was retimed or split', () => {
    const first = [cue('One.', 0, 4), cue('Two.', 4, 8)];
    const second = [cue('Uno', 0.1, 1.9), cue('(bis).', 2, 3.9), cue('Dos.', 4.5, 7.5)];
    expect(combineCues(first, second).map((c) => c.text)).toEqual([
      'One.\nUno (bis).',
      'Two.\nDos.',
    ]);
  });

  it('keeps cues of either language that have no partner, in time order', () => {
    const first = [cue('Hello.', 0, 2), cue('Bye.', 10, 12)];
    const second = [cue('Hola.', 0, 2), cue('¡Mira!', 5, 6)];
    const combined = combineCues(first, second);
    expect(combined.map((c) => c.text)).toEqual(['Hello.\nHola.', '¡Mira!', 'Bye.']);
    expect(combined[1]!.startUs).toBe(5e6);
  });

  it('keeps each language’s own line breaks', () => {
    const combined = combineCues([cue('line one\nline two', 0, 2)], [cue('uno\ndos', 0, 2)]);
    expect(combined[0]!.text).toBe('line one\nline two\nuno\ndos');
  });
});
