import { describe, expect, it } from 'vitest';
import { allSame } from './collections';

describe('allSame', () => {
  it('compares a value across items', () => {
    expect(allSame([{ v: 1 }, { v: 1 }], (i) => i.v)).toBe(true);
    expect(allSame([{ v: 1 }, { v: 2 }], (i) => i.v)).toBe(false);
    expect(allSame([], (i: { v: number }) => i.v)).toBe(true);
    expect(allSame([{ v: 3 }], (i) => i.v)).toBe(true);
  });
});
