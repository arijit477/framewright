# 0029: Frame shapes (aspect ratios)

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Every project was 16:9. Short-form video (Shorts, Reels, TikTok) is 9:16, and feed posts are 1:1
or 4:5. Positions and sizes in a project were already relative to the frame: transforms in
thousandths with media fitted to the frame (ADR 0011), and text in thousandths with sizes for a
1080-pixel reference. So the frame's shape can be a project setting rather than a property of
every clip.

## Decision

- **The shape is part of the timeline** (`aspect`: `16:9` (default), `9:16`, `1:1`, `4:5`), set
  by the engine, so changing it is one undo step and is saved with the project. Widescreen isn't
  written out, so older projects load as widescreen and save byte-for-byte unchanged. 4:5 was
  added to the roadmap's three because it's the common feed-post shape and costs nothing extra.
- **Sizes follow from the shape and the short edge** (`lib/aspect.ts`):
  - The preview draws at 1080 pixels on the short side.
  - An export's resolution names its short edge, so "1080p" is 1920×1080, 1080×1920, 1080×1080
    or 1080×1350.
  - Both sides are rounded to even numbers, as encoders need.
  - The bitrate follows the pixel count, so tall and wide frames of equal area get the same
    bitrate.
- **Text sizes refer to the short side** (was: the height). Widescreen is unchanged, and a title
  looks the same size in every shape instead of growing by 78% in a vertical frame. Text still
  wraps at 90% of the width, so it wraps more in narrow frames.
- **Media keeps fitting inside the frame** when the shape changes, so nothing is cropped
  unasked. "Fill frame" in the transform panel scales a clip to cover the frame (centred,
  cropping its edges). The scale is computed from the clip's own size, rounded up so no
  background shows.
- **The renderer is told the size** (`resize`) whenever the timeline's shape changes, before the
  next frame is drawn: on edits, undo and redo, and when a project opens.

## Consequences

- Switching shape never loses work: positions carry over, and switching back restores the
  original look.
- Widescreen footage in a vertical project needs "Fill frame", or positioning by hand.
  Following the subject automatically (smart reframing) is the next step on the roadmap.
