# 0011: Clip transforms, one placement matrix, and undoable gestures

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Picture-in-picture, rotated or faded clips, and moving things by dragging on the preview are
core editing features. Placement must match exactly between the WebGPU and Canvas 2D backends
and the export, but CI can only run Canvas 2D. Dragging produces dozens of changes per second,
yet the user expects one undo step per drag.

## Decision

- **Model:** a validated `Transform` per media clip (integers relative to the frame, like text
  styles), omitted from saved files when unchanged, so existing projects are unaffected.
- **One placement matrix:** `layerMatrix()` computes an affine transform from the source frame
  to canvas pixels; Canvas 2D uses it directly and WebGPU uses its clip-space conversion in an
  updated shader (matrix plus opacity uniform). The maths is unit-tested independently of
  either backend.
- **Gestures in the store:** live, validated updates without undo entries, then a single undo
  step at the end (or a full restore on cancel). Preview dragging is the first user.
- **Pending edits registry:** debounced inspector edits are flushed before anything reads the
  whole project (save, backup, export, unload).
- Text clips keep positioning through their style rather than also having a transform, so
  there's one way to place a title.

## Consequences

- The GPU path's placement is as trustworthy as the tested maths; its only untested surface is
  a few lines of WGSL that apply the matrix.
- Gestures are reusable for future on-preview tools (resize and rotate handles, cropping).
- Keyframed (animated) transforms are not supported yet; a transform is constant per clip.

## Alternatives considered

- **Per-backend placement code:** simpler to write, but the backends would drift and the GPU
  version couldn't be tested in CI.
- **Undo entry per pointer move, merged afterwards:** more complex and leaks intermediate states
  into autosave.
- **A transform for text too:** two competing ways to position a title; text can adopt
  transforms later if rotation or scale animations need them.
