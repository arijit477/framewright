# 0007: Store projects and copies of their media in OPFS

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Without saving, any work is lost when the tab closes. Projects reference large media files that
the browser can only read while it holds a `File` object: after a reload those references are
gone. We need persistence that works in every supported browser, survives reloads, and never
corrupts a project.

## Decision

- Store each project in the **Origin Private File System**: `project.json` plus a **copy of every
  imported file** under `media/`. Copies are streamed, so large files never sit in memory.
- Write documents with `createWritable()` (temporary file plus atomic swap on close).
- Use a **versioned, validated document format** with forward migrations, and refuse documents
  from newer versions.
- **Autosave** with a debounced, serialised scheduler, plus saves on tab hide and Ctrl+S.
- Hold an **exclusive Web Lock** per open project so two tabs can't overwrite each other.
- Treat missing media as a normal state: keep the clips, show them, and offer relinking.

## Consequences

- Projects reopen exactly as left, with media, with no permission prompts.
- Media uses disk space twice (the original plus the copy). The dialog shows usage; deleting a
  project frees its copies.
- Browser storage can be cleared by the user, or evicted under pressure (we request persistent
  storage to reduce this). Relinking recovers from it; a portable project export is on the
  roadmap for backups and moving between machines.
- Browsers without OPFS writable streams can still edit, but can't save; the app says so.

## Alternatives considered

- **File System Access API handles** (keep references to the user's files): no duplication, but
  Chromium-only, and it needs permission prompts after every reload.
- **IndexedDB blobs:** works, but large blobs are slower and less predictable across browsers than
  OPFS files, and there are no atomic file swaps.
- **A server:** would need accounts, uploads and hosting costs, and media would leave the device,
  which goes against the project's privacy goal.
