# 0033: Short fades at hard cuts (no clicks)

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

A sound that starts or stops at an arbitrary point, at the edge of a clip or on a cut between
two clips, jumps from mid-wave to silence (or from one wave to another), which is heard as a
click. Crossfades and dips (ADR 0013) already ramp the sound at their cuts. Plain cuts did not.

## Decision

- **Every edge of a clip's sound gets a 5 ms linear fade** (`DECLICK`), unless it already has a
  transition fade. That's long enough to remove the jump and too short to be heard as a fade.
  The fade is at most half the clip, so the in and out fades never overlap.
- **Except where the sound simply carries on.** If the neighbouring clip on the same track
  touches it, uses the same media at the same speed and level (neither muted), and continues
  exactly where this one leaves off, as the halves of a split clip do, there's no fade: a dip
  there would be audible where the original had none.
- **In the engine's audio segments**, so playback and export get the same fades through the
  shared mixer, which already applies segment fades sample by sample.

## Consequences

- Measured on an exported file: a 220 Hz tone cut mid-wave (a third of a cycle in) jumped by
  0.049 between neighbouring samples at the cut without the fade. With it, the jump is 0.0018,
  the same as the tone's own slope.
- A cut between two different clips loses 5 ms of loudness at the cut, which is inaudible in
  practice.
