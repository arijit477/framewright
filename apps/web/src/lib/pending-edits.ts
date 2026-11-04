/**
 * Edits that are waiting to be committed (an inspector debouncing a slider or
 * text field). Anything that reads the whole project, such as export, save
 * or backup, calls `flushPendingEdits()` first, so a change made a moment ago
 * is never left out, even if the field still has focus.
 */
const flushers = new Set<() => void>();

export function registerPendingEdits(flush: () => void): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export function flushPendingEdits(): void {
  for (const flush of flushers) flush();
}
