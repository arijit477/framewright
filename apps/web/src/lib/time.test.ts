import { describe, expect, it } from 'vitest';
import { formatRelative, formatTimecode, framesToMicros, rulerStep, secondsToMicros } from './time';

describe('formatTimecode', () => {
  it('formats minutes, seconds and frames', () => {
    expect(formatTimecode(0)).toBe('00:00:00');
    expect(formatTimecode(framesToMicros(61 * 30 + 5))).toBe('01:01:05');
  });

  it('adds hours when needed', () => {
    expect(formatTimecode(secondsToMicros(3725))).toBe('1:02:05:00');
  });

  it('clamps negative times to zero', () => {
    expect(formatTimecode(-500)).toBe('00:00:00');
  });
});

describe('frames', () => {
  it('stay exact after many steps', () => {
    expect(formatTimecode(framesToMicros(30 * 3600 * 2 + 29))).toBe('2:00:00:29');
  });
});

describe('rulerStep', () => {
  it('picks wider steps when zoomed out', () => {
    expect(rulerStep(100)).toBe(secondsToMicros(1));
    expect(rulerStep(10)).toBe(secondsToMicros(10));
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

  it('describes recent times in words', () => {
    expect(formatRelative(ago(10), now)).toBe('just now');
    expect(formatRelative(ago(5 * 60), now)).toBe('5 min ago');
    expect(formatRelative(ago(3 * 3600), now)).toBe('3 h ago');
    expect(formatRelative(ago(86_400), now)).toBe('1 day ago');
    expect(formatRelative(ago(3 * 86_400), now)).toBe('3 days ago');
  });

  it('treats clock skew (future times) as just now', () => {
    expect(formatRelative(ago(-60), now)).toBe('just now');
  });

  it('shows a date for older edits', () => {
    expect(formatRelative(ago(30 * 86_400), now)).toMatch(/2026/);
  });
});
