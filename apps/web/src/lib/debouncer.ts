/**
 * Runs the latest scheduled action after a pause; `flush` runs it now.
 * Used by inspectors so typing and slider drags become a few undo steps
 * instead of one per keystroke. Each scheduled action captures its own value,
 * so nothing reads stale state when it finally runs.
 */
export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: (() => void) | null = null;

  constructor(private readonly delayMs: number) {}

  schedule(action: () => void): void {
    this.pending = action;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    clearTimeout(this.timer);
    const action = this.pending;
    this.pending = null;
    action?.();
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.pending = null;
  }
}
