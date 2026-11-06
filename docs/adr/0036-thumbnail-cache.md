# 0036: Cached filmstrips

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Every time a project opened, each video was decoded again to rebuild its timeline filmstrip
(up to 240 thumbnails per asset). On a project with long or many videos, the filmstrips filled
in slowly and the decoder was busy just as the user wanted to work.

## Decision

- **A finished strip is saved with the project:** one WebP image with the thumbnails in a grid
  of 16 columns (a sprite), plus a small JSON description, in the project's `thumbnails` folder.
  It's deleted with the project. The largest strip (240 thumbnails at 4:1) is about
  4600×1100 pixels, well inside WebP's limits.
- **On opening a project, the cache is checked first.** On a hit, each thumbnail is cut from
  the sprite (`createImageBitmap` with a source rectangle) and the strip appears complete at
  once, with no decoding.
- **Stale strips are never shown.** The description records the file's size and modification
  time and a cache version. A relinked or different file, or a change to how thumbnails are
  made, means the strip is generated again and the cache replaced.
- **It lives in the main-thread `ThumbnailClient`;** the worker is unchanged. Saving is best
  effort: thumbnails are cosmetic, so a failure is only logged. The image is written before its
  description, so a description only ever refers to a complete image.

## Consequences

- Reopening a project draws filmstrips at once. The test counts the requests made to the
  thumbnail worker: none after a reload.
- Each video costs a few hundred kilobytes of storage for its strip.
