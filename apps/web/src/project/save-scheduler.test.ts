import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveScheduler, type SaveState } from './save-scheduler';

/** A save function we can pause, to test overlap and failure handling. */
function controllableSave() {
  const calls: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const save = vi.fn(() => new Promise<void>((resolve, reject) => calls.push({ resolve, reject })));
  return { save, calls };
}

describe('SaveScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces bursts of changes into one save', async () => {
    const save = vi.fn(async () => {});
    const scheduler = new SaveScheduler(save, 500);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(300);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(300);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.current).toBe('saved');
  });

  it('never runs two saves at once, and saves again if changed meanwhile', async () => {
    const { save, calls } = controllableSave();
    const scheduler = new SaveScheduler(save, 100);
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.current).toBe('saving');

    scheduler.markDirty(); // edit while saving
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1); // still only one in flight

    calls[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2); // the follow-up save
    calls[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.current).toBe('saved');
  });

  it('reports failures and retries on the next flush', async () => {
    const { save, calls } = controllableSave();
    const states: SaveState[] = [];
    const scheduler = new SaveScheduler(save, 100, (s) => states.push(s));
    scheduler.markDirty();
    const first = scheduler.flush();
    calls[0]!.reject(new Error('quota exceeded'));
    await first;
    expect(scheduler.current).toBe('error');
    expect(scheduler.hasUnsavedChanges).toBe(true);

    const retry = scheduler.flush();
    calls[1]!.resolve();
    await retry;
    expect(scheduler.current).toBe('saved');
    expect(states).toEqual(['dirty', 'saving', 'error', 'saving', 'saved']);
  });

  it('flush waits for everything to be written', async () => {
    const { save, calls } = controllableSave();
    const scheduler = new SaveScheduler(save, 10_000);
    scheduler.markDirty();
    let done = false;
    const flushed = scheduler.flush().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    calls[0]!.resolve();
    await flushed;
    expect(done).toBe(true);
  });

  it('does nothing when there is nothing to save', async () => {
    const save = vi.fn(async () => {});
    await new SaveScheduler(save, 100).flush();
    expect(save).not.toHaveBeenCalled();
  });
});
