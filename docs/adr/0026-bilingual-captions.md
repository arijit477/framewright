# 0026: Bilingual captions

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Translated captions (ADR 0024, ADR 0025) go on their own track, in the original's place, so
showing both languages meant moving one track's captions by hand. Even then they overlapped
whenever either wrapped to more lines, because a title's `y` was the middle of its block: it
grows both up and down.

## Decision

- **A vertical anchor for text** (`TextStyle.anchorY`: `middle` (default), `top` or `bottom`):
  which edge of the block sits at `y`. Middle isn't saved, so existing projects and titles are
  unchanged. `layoutText` applies it, so preview, export and dragging on the preview all agree.
- **"Show both languages"** in the Translate dialog (remembered):
  - The original captions move up to sit on a shared line, anchored by their bottom edge.
  - The translation goes under that line, anchored by its top edge, at 80% of the original's
    size. Each keeps a gap that covers its box padding.
  - So neither can grow into the other, however many lines either wraps to, at any frame size
    (checked for 16:9, 9:16 and 720p in unit tests, and on exported frames in e2e).
  - The line is where the original was, held between 15% and 83% of the frame height, so the
    translation stays clear of the bottom edge.
  - The original keeps its word highlight.
  - Moving the original and adding the translation are one undo step.
- **Two tracks, not one combined title:** each language stays a separate, editable caption track
  with its own .srt/.vtt export and its own word timings.

## Consequences

- Moving one language's captions afterwards no longer moves the other; the two tracks can be
  positioned independently (or the translation deleted to go back to one language).
- A bilingual subtitle file (both languages per cue) isn't produced; each track exports alone.

## Alternatives considered

- **One title with both languages on separate lines:** simplest on screen, but it breaks word
  highlighting (word counts must match the text), per-language editing and per-language files.
- **Computing each translation's position from line counts:** fragile. Wrapping depends on the
  frame width (vertical video wraps more), the font and the size.
