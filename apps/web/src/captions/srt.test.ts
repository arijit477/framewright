import { describe, expect, it } from 'vitest';
import { formatCaptionTime, toSrt, toVtt } from './srt';

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
