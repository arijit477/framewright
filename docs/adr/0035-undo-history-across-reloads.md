# 0035: Undo history that survives a reload

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Projects autosave, but the undo history lived only in memory: closing the tab or reloading kept
the work and lost every chance to step back through it.

## Decision

- **Saved beside the project, not inside it** (`history.json` in the project's folder,
  `project/history.ts`). It can be large (each step is a whole timeline snapshot, as the editor
  keeps them), and the project file stays small, readable and portable. Backups don't include
  history.
- **Written with each autosave, only when it changed** (a revision counter bumped by edits, undo,
  redo and opening a project). It's best effort: a failure is logged and never fails the project
  save.
- **Bounded:** the steps nearest the present are kept within 8 MB, redo steps within a quarter
  of that, newest first. That's on top of the editor's own limit of 100 steps.
- **Only applied to the timeline it belongs to.** The file records a fingerprint (FNV-1a, 64-bit)
  of the timeline the history leads to. On opening, the history is restored only if it matches
  the timeline just loaded. A mismatch (the project changed some other way, e.g. by an older
  version of the app or a restored backup) means it's ignored rather than applied to the wrong
  state. So is a file this version can't read.
- **What earlier steps need comes with them:**
  - Removed LUTs that an undo or redo step still uses are saved in the history file. They're put
    back when undo brings back their use, as they are within a session.
  - Media needs nothing extra: imported files stay with the project even when no clip uses them.

## Consequences

- Undo and redo work across reloads, tab closes and switching projects.
- Saving costs one extra file write when the history changed (up to 8 MB for long histories of
  large projects).
