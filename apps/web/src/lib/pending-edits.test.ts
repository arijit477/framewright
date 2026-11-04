import { describe, expect, it, vi } from 'vitest';
import { flushPendingEdits, registerPendingEdits } from './pending-edits';

describe('pending edits', () => {
  it('flushes every registered editor until it unregisters', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unregisterA = registerPendingEdits(a);
    const unregisterB = registerPendingEdits(b);
    flushPendingEdits();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unregisterA();
    flushPendingEdits();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    unregisterB();
  });
});
