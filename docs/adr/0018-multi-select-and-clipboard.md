# 0018: Multi-select and copy/paste

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Editing one clip at a time is slow: removing several clips, nudging a clip with its music, or
reusing a title all took repeated work. Editors offer a multi-clip selection and a clipboard.

## Decision

- **Selection:** `selectedClipIds` holds every selected clip. `selectedClipId` stays as the clip
  the panel edits (the last one clicked), so single-clip features are unchanged.
  Ctrl/⌘/Shift-click adds or removes a clip, Ctrl/⌘+A selects all, and a plain click on a clip of a
  multi-selection narrows it to that clip. The accessible track list marks selected clips.
- **Bulk edits:** Delete removes every selected clip in one undo step (latest first, so ripple
  deletes compose correctly). Dragging one selected clip moves the whole selection in time, each
  clip staying on its own track. This is the engine's `move_clips`: all or nothing, refusing
  overlaps or times before 0, and the drag stops when the earliest clip reaches 0.
- **Clipboard:** the engine both serialises (`copy_clips`: each clip with its track, times relative
  to the earliest) and pastes (`paste_clips`), so the format can't drift between Rust and
  TypeScript.
  - A paste puts the earliest clip at the playhead and keeps the spacing.
  - Each original track gets its clips back if it still exists and has room for all of them.
    Otherwise they go on a new track (a new top layer for video, a new bottom row for audio), so
    a paste never overwrites anything.
  - Pasted clips keep their speed, transform, keyframes, colour and transition, and become the
    selection.
- The clipboard lives in memory for the tab. Pasting into another project works for titles and
  for media that project also has; other clips are left out, with a notice.
- Clipboard shortcuts are handled after the text-field check, so Ctrl/⌘+A/C/X/V keep working
  normally while typing.

## Consequences

- No project format change.
- Not yet: moving a selection across tracks, and pasting between tabs (the system clipboard
  would also need the media).

## Alternatives considered

- **System clipboard (JSON):** works across tabs, but pasted clips would reference media the
  other project doesn't have; copying media through the clipboard is a bigger feature.
- **Paste overwriting what's underneath:** matches some editors, but destroys work silently.

## Addendum: selection box (marquee)

- Dragging on empty track space draws a selection box. Every clip it touches, on any row, is
  selected live (`clipsInRect` in `timeline/geometry.ts`, unit-tested). With Ctrl/⌘/Shift held,
  the box adds to the existing selection.
- This replaces scrubbing from empty track space; the ruler still scrubs. A plain click on empty
  space still deselects and moves the playhead, now on release, so starting a box never moves
  the playhead.
- The box is mouse-only. Keyboard selection of clips (the timeline is a canvas) is a separate
  accessibility item.

## Addendum: duplicate

- Ctrl/⌘+D (or the Duplicate button) copies the selection with the engine's `copy_clips` and
  pastes it with `paste_clips` right after itself: the earliest copy starts where the selection
  ends, spacing and tracks kept. The copies become the selection. It's one undo step, and the
  clipboard is left alone.
- Without ripple, it behaves like paste: copies that don't fit go on a new track, never over
  existing clips.
- With ripple on, it inserts. The engine's new `insert_space(tracks, at, length)` first opens a
  gap the length of the selection on the selection's tracks (later clips move along), so the
  copies land in line. It refuses, changing nothing, when a clip runs across the insertion point.

## Addendum: editing several clips at once

- With several clips selected, the clip panel shows the settings they share: **speed, volume and
  mute** for media clips, and **colour** (white balance, LUT and intensity, brightness, contrast,
  saturation, looks) for clips with a picture. Titles are left out, and audio-only clips get no
  colour; the panel says how many clips each section affects.
- **A change sets only that setting** on every clip (`setClipsColor(ids, patch)` and friends in
  `store/editor.ts`), so changing brightness on three clips keeps each one's own saturation and
  LUT. Each change is one undo step for all the clips.
- **Values that differ read "Mixed"** (slider readouts and `aria-valuetext`, a "Mixed" entry in
  the Speed and LUT menus, `aria-pressed="mixed"` on Mute). Controls start at the main clip's
  value, and a look counts as chosen only when every clip matches it.
- **Speed with ripple:** clips are processed latest first, so each one's shift composes.
- **Per-clip only:** transform, keyframes and transitions stay single-clip; the panel says so.
- M (mute) now applies to the whole selection: it mutes all, or unmutes all if all are muted.
