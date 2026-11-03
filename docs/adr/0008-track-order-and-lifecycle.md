# 0008: Track display order and automatic track lifecycle

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

With several video tracks, users expect the top row of the timeline to be the top layer of the
picture (Premiere, Resolve and CapCut all work this way). The engine already composites video
tracks with higher indices on top (`resolve()` returns layers bottom first). We also need a
simple way to create tracks without track-management UI, and empty tracks shouldn't pile up.

## Decision

- Keep the engine's model: **higher index = higher layer**. The UI displays video tracks in
  **reverse index order** (top row = top layer), then audio tracks. One pure function,
  `trackRows()`, defines the display order for drawing, hit testing, drop targets and the
  accessible description.
- New tracks are appended in the engine, so a new video track is automatically the top layer
  and the top row.
- **Tracks are created by dragging:** a video clip dropped above the top video row (or an audio
  clip below the last audio row) gets a new track.
- **Empty tracks are removed automatically** after moves and deletes (`pruneEmptyTracks`),
  keeping at least one track of each kind, in the same undo step as the edit.
- Every edit is **atomic**: on failure, the pre-edit snapshot is restored.

## Consequences

- No migration: existing projects (one video and one audio track) look and behave the same.
- The track-order mapping lives in one tested function, so it can't diverge between drawing
  and interaction.
- There is no way yet to keep an empty track, or to reorder tracks without moving clips. Track
  headers (lock, hide, mute, reorder) are a later addition.

## Alternatives considered

- **Reverse the engine's layering (index 0 on top):** would match the display directly, but
  changes the meaning of existing projects and of `resolve()`, and needs a migration.
- **Explicit "add/remove track" buttons only:** more UI for a less direct workflow. They can
  still be added later alongside drag-to-create.
