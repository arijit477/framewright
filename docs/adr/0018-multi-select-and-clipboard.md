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
- Not yet: rubber-band (marquee) selection, moving a selection across tracks, duplicate,
  editing several clips' settings at once, and pasting between tabs (the system clipboard
  would also need the media).

## Alternatives considered

- **System clipboard (JSON):** works across tabs, but pasted clips would reference media the
  other project doesn't have; copying media through the clipboard is a bigger feature.
- **Paste overwriting what's underneath:** matches some editors, but destroys work silently.
