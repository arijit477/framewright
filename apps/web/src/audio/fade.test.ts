import { describe, expect, it } from 'vitest';
import { fadeGain } from './fade';

const fade = (curve: 'linear' | 'equalPower') => ({ start: 1000, end: 3000, curve });

describe('fadeGain', () => {
  it('holds outside the fade', () => {
    expect(fadeGain(fade('linear'), 'in', 0)).toBe(0);
    expect(fadeGain(fade('linear'), 'in', 5000)).toBe(1);
    expect(fadeGain(fade('equalPower'), 'out', 0)).toBe(1);
    expect(fadeGain(fade('equalPower'), 'out', 5000)).toBeCloseTo(0);
  });

  it('ramps linearly or at equal power', () => {
    expect(fadeGain(fade('linear'), 'in', 2000)).toBe(0.5);
    expect(fadeGain(fade('linear'), 'out', 2500)).toBe(0.25);
    const into = fadeGain(fade('equalPower'), 'in', 1700);
    const out = fadeGain(fade('equalPower'), 'out', 1700);
    expect(into ** 2 + out ** 2).toBeCloseTo(1);
    expect(fadeGain(fade('equalPower'), 'in', 2000)).toBeCloseTo(Math.SQRT1_2);
  });

  it('treats an empty fade as already done', () => {
    expect(fadeGain({ start: 5, end: 5, curve: 'linear' }, 'in', 0)).toBe(1);
  });
});
