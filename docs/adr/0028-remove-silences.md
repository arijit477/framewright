# 0028: Removing silences

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Talking-head and tutorial videos are full of pauses, and cutting them by hand (split, split,
ripple delete, for every pause) is the most tedious part of editing them. Editors offer a
one-click "remove silences".

## Decision

- **Scope: the selected clips.**
  - Each selected media clip with sound (not muted) is analysed on its own sound.
  - Its silences are cut out and the gaps closed on its own track, like a ripple delete.
  - Other tracks don't move, so this is best done before adding captions or music; the dialog
    says so.
  - Rejected:
    - cutting the same time from every track: it keeps sync, but it cuts music under a pause;
    - only marking the silences for review: it leaves the tedious part to the user.
- **Analysis (`silence/silence.worker.ts`):**
  - Each clip is played alone through the playback mixer at 16 kHz, so its source range and
    speed are exactly as heard. Its volume and fades are left out: they shape the mix, not where
    the speaker paused, so a quiet clip isn't mistaken for silence.
  - Loudness is the RMS level in 10 ms windows.
- **Detection (`silence/detect.ts`):**
  - A pause is silence when it stays below a threshold for at least a minimum length.
  - A margin is kept on both sides so the ends of words and breaths aren't clipped. Silence at
    the very start or end of a clip is cut right to the edge, because there's no word there to
    protect.
  - Defaults: below −40 dB, for at least 0.5 s, keeping 150 ms. All three can be changed in the
    dialog, and are remembered.
- **Editing (`removeSilences`):**
  - Each silence is split out and ripple-deleted, latest first: a ripple only moves what is to
    its right, so every cut still to come keeps its analysed position.
  - A cut within 10 ms of a clip edge goes to the edge, because the engine keeps no sliver
    clips.
  - All of it is one undo step.

## Consequences

- Cut points follow the sound as played. At 2× speed a pause plays for half as long, so it may
  fall under the minimum. The pitch-keeping time stretch also blurs edges by a few milliseconds.
- Fixed thresholds (not adaptive to room noise) are simple and predictable. A noisy recording
  may need a higher threshold.
