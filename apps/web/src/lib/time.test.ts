import { describe, expect, it } from 'vitest';
import { formatTimecode, framesToMicros, rulerStep, secondsToMicros } from './time';

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
