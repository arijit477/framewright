# 0039: Resize and rotate handles on the preview

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

A clip could be moved by dragging it on the preview, but resizing and rotating it meant using
the Scale and Rotation sliders in the Transform panel. Every other editor lets you grab a
clip's corner or turn it directly on the picture.

## Decision

- **An overlay for the selected video or image clip while it's on screen**
  (`app/TransformHandles.tsx`): an outline of the clip, four square corner handles and one
  round rotate handle. They are DOM elements over the canvas: the outline ignores the pointer,
  so dragging inside the clip still moves it as before. Titles get no handles: their size is a
  font size and they have no rotation.
- **The outline uses the renderer's own placement** (`layerMatrix`), so it matches the picture
  at any scale, rotation, position, aspect and preview size (`app/handles.ts`, unit-tested).
- **Resizing scales the clip about its centre, keeping its shape.** The scale follows the
  pointer's distance from the centre, so the grabbed corner stays under the pointer.
- **Rotating follows the pointer's angle around the centre.** Shift snaps it to multiples of
  15°, and angles stay within −180…180°. The rotate handle sits just above the clip's top edge,
  or just inside it when above would be off the preview (as for a full-frame clip).
- **The same gesture machinery as moving.** Each drag is one undo step, Escape or a cancelled
  pointer restores the start, and an animated clip is keyframed at the playhead.
- The preview frame no longer clips its contents (the canvas has its own rounded corners), so
  handles at the frame's corners show in full.

## Consequences

- Resizing and rotating are direct, and the sliders remain for exact values and for keyboard
  users (the handles take only the pointer).
- Tests drag the real handles: a corner to half size, checked in an export as well as in the
  Scale slider; the rotate handle a quarter turn, and with Shift snapping; Escape, undo, and no
  handles for titles or off-screen clips.
