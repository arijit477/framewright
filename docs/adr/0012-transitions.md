# 0012: Transitions centred on the cut, owned by the incoming clip

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Transitions (crossfade, dip, slide, wipe) are expected in any editor. Our tracks never let clips
overlap, so a transition can't be modelled as two overlapping clips. Users also expect a
transition to stay attached when they trim or move clips, and not to need special footage.

## Decision

- A transition is a property of the **incoming** clip and is **centred on the cut**: for
  duration D, the outgoing clip plays on for D/2 and the incoming one starts D/2 early, both
  from their own media (holding the edge frame when a file has no extra media there). This is
  the standard "centre on cut" behaviour of professional editors and keeps the no-overlap
  track model intact.
- It's active only while the clips touch. Moving them apart keeps the setting but disables
  it, and moving them back restores it, so no data is silently lost. Splitting a clip doesn't
  create a transition between the halves.
- The engine resolves the two layers and the progress. A single tested function maps that to
  per-layer effects (opacity, offset, reveal), which both compositors apply on top of the
  existing placement matrix (ADR 0011).
- Video only at first; audio crossfades followed in ADR 0013.

## Consequences

- No changes to how clips are stored or laid out; old projects are unaffected.
- Transitions work identically in the preview, both renderers and export.
- "Dip" fades through whatever is underneath (black on the bottom track), which is what an
  upper-track dip should do.
- Audio crossfades need a matching change in the mixer (done in ADR 0013).

## Alternatives considered

- **Overlapping clips during the transition (iMovie-style):** breaks the no-overlap rule that
  editing, snapping and trimming rely on.
- **Transitions as separate timeline objects:** more state to keep consistent when clips move,
  split or are deleted.
- **Use only the clips' existing frames (shorten both):** changes the edit's timing when a
  transition is added, which users don't expect.
