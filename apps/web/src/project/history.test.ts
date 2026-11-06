import { describe, expect, it } from 'vitest';
import { fingerprint, parseHistory, serializeHistory, trimHistory } from './history';

describe('fingerprint', () => {
  it('is stable for the same text and differs for different text', () => {
    expect(fingerprint('{"tracks":[]}')).toBe(fingerprint('{"tracks":[]}'));
    expect(fingerprint('{"tracks":[]}')).not.toBe(fingerprint('{"tracks":[1]}'));
    expect(fingerprint('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('trimHistory', () => {
  const step = (n: number, size = 10) => `${n}`.padEnd(size, '.');

  it('keeps everything within the budget', () => {
    const undo = [step(1), step(2)];
    const redo = [step(9)];
    expect(trimHistory(undo, redo, 1000)).toEqual({ undo, redo });
  });

  it('drops the oldest undo steps first, keeping the newest', () => {
    const undo = [1, 2, 3, 4, 5].map((n) => step(n));
    expect(trimHistory(undo, [], 30).undo).toEqual([step(3), step(4), step(5)]);
  });

  it('keeps the next redo steps within a quarter of the budget', () => {
    // Redo: the last entry is the next one; the furthest are dropped.
    const redo = [step(8), step(7), step(6)];
    const { undo, redo: kept } = trimHistory([step(1), step(2)], redo, 80);
    expect(kept).toEqual([step(7), step(6)]);
    expect(undo).toEqual([step(1), step(2)]);
  });
});

describe('saved history files', () => {
  const lut = { id: 'teal', name: 'Teal', size: 2, data: 'A'.repeat(Math.ceil((8 * 6) / 3) * 4) };

  it('round-trips', () => {
    const history = { current: 'abc', undo: ['{"a":1}'], redo: ['{"b":2}'], luts: [lut] };
    expect(parseHistory(serializeHistory(history))).toEqual(history);
  });

  it('ignores anything it can’t use rather than failing', () => {
    expect(parseHistory('not json')).toBeNull();
    expect(parseHistory('{"format":"something-else"}')).toBeNull();
    expect(
      parseHistory(
        JSON.stringify({
          format: 'framewright-history',
          version: 99,
          current: 'x',
          undo: [],
          redo: [],
          luts: [],
        }),
      ),
    ).toBeNull();
    expect(
      parseHistory(
        JSON.stringify({
          format: 'framewright-history',
          version: 1,
          current: 'x',
          undo: [1],
          redo: [],
          luts: [],
        }),
      ),
    ).toBeNull();
    expect(
      parseHistory(
        JSON.stringify({
          format: 'framewright-history',
          version: 1,
          current: 'x',
          undo: [],
          redo: [],
          luts: [{ id: '' }],
        }),
      ),
    ).toBeNull();
  });
});
