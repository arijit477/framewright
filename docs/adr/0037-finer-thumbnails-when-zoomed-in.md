# 0037: Finer thumbnails when zoomed in

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The base filmstrip has at most one thumbnail per second of source (ADR 0036 caches it). Zoomed
far in (up to 800 px/s), one tile covers about a tenth of a second, so runs of eight or more
neighbouring tiles repeated the same picture. That made it hard to find a cut point by eye.

## Decision

- **Fixed detail levels:** thumbnails spaced every 0.5, 0.25, 0.125 or 0.0625 s
  (`thumbnails/detail.ts`). The timeline picks the coarsest level no longer than a tile, and
  only once the base strip would show the same picture on more than two neighbouring tiles.
  Because the levels are fixed, a small change of zoom reuses the same thumbnails instead of
  asking for new ones.
- **On demand, for what's on screen:** while drawing, the timeline uses each tile's detail
  thumbnail if it has arrived, and otherwise the base strip. The missing ones are requested from
  the thumbnail worker in one batch per asset.
- **Detail requests go first in the worker**, ahead of base strips (the user is looking at
  them). A new request for an asset cancels its older, unstarted one, because the view has moved.
  The reply echoes the spacing it was made for, so a late reply is filed under the right level.
- **Bounded memory:** up to 240 detail thumbnails per asset (about 9 MB) in an LRU cache that
  closes evicted bitmaps. They are not saved with the project: the base strip already covers the
  normal zoom levels, and detail is cheap to remake for a short view.
- Still images get no detail: their one picture is exact at any zoom.

## Consequences

- Zoomed in, every tile shows its own moment once the request has been served (a fraction of a
  second for a screenful). Until then, tiles show the base strip, as before.
- The test uses a video whose hue turns a full circle each second. At the maximum zoom it
  checks that neighbouring tiles show different colours (without detail, none of them do).
