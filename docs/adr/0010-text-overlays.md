# 0010: Text overlays as clips, with one shared renderer

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Titles and captions are the most used feature in short-form editing. They must move, trim,
split, layer and undo like any clip, look identical in the preview and the export at every
resolution, and work on both rendering backends (WebGPU and Canvas 2D).

## Decision

- **Text clips are clips:** a `text` field (content + style) on the existing clip type, with no
  media and an effectively unlimited source. They live on video tracks, so the layering rules
  of ADR 0008 apply: a title on a higher track overlays the footage below.
- **The engine validates styles,** and sizes and positions are integers relative to a 1080p
  frame (exact, and resolution-independent).
- **One renderer** (`render/text.ts`) is used by both compositors and by export. On WebGPU, text
  is rasterised on a transparent canvas and imported as a `VideoFrame`, reusing the existing
  self-tested video pipeline instead of adding a second, separately tested texture pipeline.
  The startup self-test now also verifies that transparency survives.
- **Generic system font stacks** for now, because fonts must be available inside workers for
  export to match the preview.

## Consequences

- Every existing editing operation, plus saving, backups and undo, works for text with no
  special cases beyond creation and styling.
- A title costs one full-frame canvas draw and upload per frame on WebGPU. That's cheap at
  editing frame rates; it can be cached per style and animation state if profiling shows a
  need.
- Fonts differ slightly between operating systems. Within one machine, preview and export
  match.

## Alternatives considered

- **A separate text track kind:** more UI and model surface, and stacking text between video
  layers (e.g. a title under a logo overlay) would need extra rules.
- **DOM text over the preview:** easy in the preview, but export would need a second renderer,
  and the two would drift apart.
- **A dedicated WebGPU text pipeline (glyph atlas):** faster for many layers, but a large amount
  of untestable-in-CI GPU code for little gain today.
