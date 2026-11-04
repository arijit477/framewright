import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Debouncer } from './debouncer';

describe('Debouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs only the latest action, after the pause', () => {
    const d = new Debouncer(100);
    const ran: number[] = [];
    d.schedule(() => ran.push(1));
    vi.advanceTimersByTime(50);
    d.schedule(() => ran.push(2));
    vi.advanceTimersByTime(99);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual([2]);
  });

  it('flush runs the pending action now, once', () => {
    const d = new Debouncer(100);
    const action = vi.fn();
    d.schedule(action);
    d.flush();
    d.flush();
    vi.advanceTimersByTime(200);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending action', () => {
    const d = new Debouncer(100);
    const action = vi.fn();
    d.schedule(action);
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(action).not.toHaveBeenCalled();
  });
});
