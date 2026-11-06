/**
 * Undo history saved with a project, so closing the tab (or a reload) doesn't
 * lose it. Kept beside the project file (`history.json`), not inside it: it
 * can be large, and the project file stays small, readable and portable
 * (backups don't include history).
 *
 * Each step is a whole timeline snapshot, as the editor keeps them. The file
 * records a fingerprint of the timeline it belongs to; if the project was
 * changed some other way (an older version of the app, a restored backup),
 * the fingerprints differ and the history is ignored rather than applied to
 * the wrong timeline.
 */
import { validateLut, type ProjectLut } from './document';

export const HISTORY_FORMAT = 'framewright-history';
export const HISTORY_VERSION = 1;

/** Enough for typical projects' full history, and a bound on writing it at every autosave. */
export const HISTORY_BUDGET_BYTES = 8 * 1024 * 1024;

export interface SavedHistory {
  /** Fingerprint of the timeline the history leads to (see `fingerprint`). */
  current: string;
  /** Oldest first, as the editor's undo stack. */
  undo: string[];
  /** Furthest first: the last entry is the next redo. */
  redo: string[];
  /** LUTs removed from the project that steps in the history still use. */
  luts: ProjectLut[];
}

/** FNV-1a (64-bit) of a string, as hex: a cheap check that two timelines are the same. */
export function fingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Keep the steps nearest the present within `budget` characters: redo steps
 * (up to a quarter of the budget) and undo steps, newest first. Older steps are
 * dropped, as the editor's own history limit drops them.
 */
export function trimHistory(
  undo: readonly string[],
  redo: readonly string[],
  budget = HISTORY_BUDGET_BYTES,
): { undo: string[]; redo: string[] } {
  let left = budget;
  const take = (steps: readonly string[], limit: number) => {
    const kept: string[] = [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const size = steps[i]!.length;
      if (size > Math.min(left, limit)) break;
      kept.unshift(steps[i]!);
      left -= size;
      limit -= size;
    }
    return kept;
  };
  const keptRedo = take(redo, budget / 4);
  const keptUndo = take(undo, left);
  return { undo: keptUndo, redo: keptRedo };
}

export function serializeHistory(history: SavedHistory): string {
  return JSON.stringify({ format: HISTORY_FORMAT, version: HISTORY_VERSION, ...history });
}

/** The saved history, or null if the file isn't one this version can use (it's then ignored). */
export function parseHistory(text: string): SavedHistory | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const strings = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((s) => typeof s === 'string');
    if (
      value?.format !== HISTORY_FORMAT ||
      value.version !== HISTORY_VERSION ||
      typeof value.current !== 'string' ||
      !strings(value.undo) ||
      !strings(value.redo) ||
      !Array.isArray(value.luts)
    ) {
      return null;
    }
    return {
      current: value.current,
      undo: value.undo,
      redo: value.redo,
      luts: value.luts.map((lut, i) => validateLut(lut, i)),
    };
  } catch {
    return null;
  }
}
