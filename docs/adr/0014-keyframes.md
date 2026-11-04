# 0014: Keyframes for transforms

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Transforms (ADR 0011) place a clip statically. Editors expect to animate them: slow zooms
(Ken Burns), moving picture-in-picture, fades by opacity. The animation must look identical in
the preview and the export, survive trimming and splitting, and stay smooth. Stored values are
integers (thousandths of the frame, whole percent and degrees), which would visibly step if
animation used them directly.

## Decision

- **A keyframe holds a whole transform** (`{ sourceTime, transform, easing }`), as in most
  consumer editors, rather than one track per property. One control adds or removes a
  keyframe at the playhead; changing any slider on an animated clip writes into the keyframe
  at the playhead (adding one if needed).
- **Keyframes are anchored to source-media time**, not timeline or clip-relative time. Trimming a
  clip's start leaves the animation on the same picture moment, and both halves of a split keep
  every keyframe, so the motion continues seamlessly across the cut. Keyframes outside a trimmed
  clip still shape the motion; the UI just doesn't show them.
- **The engine interpolates** (`keyframe.rs`): linear in every property (rotation in plain degrees,
  so 0° to 360° is a full spin), shaped by the leaving keyframe's easing (linear, ease in, ease
  out, ease in and out), holding before the first and after the last keyframe. The result is
  fractional (`ResolvedTransform`), so `Layer.transform` is smooth; the renderers already take
  numbers. The editor asks the engine (`clipTransformAt`) for the value at the playhead rather
  than re-implementing interpolation in TypeScript.
- While a clip has keyframes, its static `transform` is unused. Removing the last keyframe or
  "Remove all" writes the current look into the static transform, so the clip doesn't jump.
- At most 100 keyframes per clip; edits keep them sorted with one per moment, and loading
  normalises hand-edited files.

## Consequences

- Old projects are unaffected (`keyframes` is omitted when empty).
- Preview, both renderers and export animate identically, with no renderer changes.
- The playhead is "on" a keyframe within half a preview frame, so stepping and clicking find it.
- Not yet: per-property keyframes, dragging keyframes on the timeline, keyframing text styles,
  and Bézier easing curves.

## Alternatives considered

- **Per-property keyframe tracks (After Effects style):** more flexible, but many more controls
  and harder to use for the common cases.
- **Clip-relative times:** a trim would shift the animation against the picture.
- **Interpolating stored integers:** visible steps in slow moves (1% scale steps).
