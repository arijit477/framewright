export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * Debounced, serialised autosave.
 *
 * - `markDirty()` after every change; the save runs `delayMs` after the last one.
 * - Saves never overlap. A change during a save triggers one more save after it.
 * - A failed save leaves the state at 'error' and is retried on the next change
 *   or `flush()`, so nothing is silently lost.
 */
export class SaveScheduler {
  private state: SaveState = 'saved';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private dirtyDuringSave = false;
  private lastError: unknown = null;

  constructor(
    private readonly save: () => Promise<void>,
    private readonly delayMs: number,
    private readonly onChange: (state: SaveState, error: unknown) => void = () => {},
  ) {}

  get current(): SaveState {
    return this.state;
  }

  get hasUnsavedChanges(): boolean {
    return this.state !== 'saved';
  }

  markDirty(): void {
    if (this.running) this.dirtyDuringSave = true;
    else this.setState('dirty');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Save now if there are unsaved changes, and wait until everything is written. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      this.dirtyDuringSave = true;
      await this.running;
      return;
    }
    if (this.state === 'saved') return;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    if (this.dirtyDuringSave) {
      this.dirtyDuringSave = false;
      this.setState('dirty');
      await this.flush();
    }
  }

  /** Forget pending work (e.g. when switching projects after a flush). */
  reset(): void {
    clearTimeout(this.timer);
    this.dirtyDuringSave = false;
    this.setState('saved');
  }

  private async run(): Promise<void> {
    this.setState('saving');
    try {
      await this.save();
      this.lastError = null;
      this.setState('saved');
    } catch (error) {
      this.lastError = error;
      this.setState('error');
    }
  }

  private setState(state: SaveState) {
    this.state = state;
    this.onChange(state, this.lastError);
  }
}
