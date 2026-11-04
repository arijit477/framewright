# 0020: Keyboard access to the timeline

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

The timeline is drawn on a canvas, so keyboard and screen-reader users could hear the clips (the
visually hidden track list) but not select them. Every clip operation (delete, speed, colour,
duplicate, copy) starts from a selection. Meanwhile, the arrow keys already step frames
everywhere, and mouse users rely on that after clicking a clip.

## Decision

- **The canvas is a focus stop** (`tabIndex=0`, `role="application"` so screen readers pass the
  arrow keys through), labelled "Timeline". A visually hidden description explains the keys, and
  a focus ring shows when it has keyboard focus.
- **Keys while it has focus:**
  - **Left/Right:** previous or next clip on the same track.
  - **Up/Down:** the nearest clip in time on the track above or below, skipping empty tracks.
  - **Home/End:** first or last clip on the track.
  - **Shift+Left/Right:** add clips to the selection.
  - **Escape:** clear the selection.
  - With nothing selected, the first move starts from the clip under the playhead.

  The logic is `stepClip` in `timeline/geometry.ts`, unit-tested. The playhead follows to the
  clip's start, and the view scrolls to keep it visible. Everything else (Delete, M, Ctrl/⌘+C/D…)
  already works on the selection.

- **Announcements:** a polite live region (`aria-live`, deliberately without the `status` role, which the app's notifications use) says where the selection went, e.g. "red.webm on
  Video 1, 00:06:00 to 00:09:00. 2 clips selected." Track names come from the same `trackNames`
  helper as the track list.
- **Mouse clicks don't focus the timeline** (mousedown is prevented). So for mouse users the
  arrow keys keep stepping frames, and only someone who tabbed in gets clip navigation. Clicking
  still takes focus away from a field, as before, so shortcuts work after editing a slider.
- **Handled keys are marked** (`preventDefault`), and the app-wide shortcut handler skips events
  already handled, so the two never both act on one key press.

## Consequences

- Keyboard users can now select, inspect and edit any clip.
- Moving and trimming clips from the keyboard followed (addendum below).

## Alternatives considered

- **Arrow keys always navigate clips:** would take frame stepping away from mouse users.
- **A visually hidden list of clip buttons:** focus would be invisible to sighted keyboard users.

## Addendum: moving and trimming from the keyboard

These keys work whenever clips are selected and no field has focus, so mouse users get them too:

- **Alt+Left/Right** nudges the selection by a frame (Alt+Shift: 10), landing the main clip on
  the frame grid. It uses the engine's all-or-nothing `move_clips`; when another clip or the start
  of the timeline is in the way, nothing moves and that is announced. Nudges made while Alt stays
  down are one undo step: they run as a gesture (`beginGesture`/`updateGesture`), closed when Alt
  is released or the window loses focus.
- **Alt+Up/Down** moves the selected clip to the track above or below of its kind. Past the top
  video track or the bottom audio track it makes a new track, like a mouse drag. It's for one
  clip at a time, and the panel says so otherwise.
- **`[` and `]`** trim the selected clips the playhead is inside so they start or end there: one
  undo step, and ripple-aware (the clip keeps its place; the rest of its track follows).
- **`,` and `.`** step the playhead a frame (Shift: 10), so keyboard users in the timeline, where
  the arrows select clips, can still move the playhead.
- The live region moved into the store (`announce`, `describeClip`), so any of these actions can
  say what happened.
