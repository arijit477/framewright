# 0013: Audio crossfades under video transitions

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Video transitions (ADR 0012) blend the picture across a cut, but the sound still cut hard at
the edit point, which is jarring and unlike every other editor. Playback and export must
sound identical, and the audio path is time-critical (the audio clock drives playback,
ADR 0005).

## Decision

- **The video transition drives the audio.** There is no separate audio-transition setting:
  whenever a transition is active on a cut, the two clips' sounds fade across the same window.
- **The engine describes the fades** (`timeline.rs`): each `AudioSegment` may carry `fadeIn`
  and `fadeOut`, each a `{ start, end, curve }` in timeline microseconds.
  - **Crossfade, slide, wipe:** like the picture, the outgoing sound plays on for `D/2` past the
    cut and the incoming one starts `D/2` early, each from its own media, with **equal-power**
    curves (`sin`/`cos`), so loudness stays steady through the overlap. Unlike video (where an
    edge frame can be held), there is no sensible way to "hold" sound, so each side extends only
    as far as its file has spare media; the fade still ends at the window's edge.
  - **Dip:** the outgoing sound fades out to the cut and the incoming one fades in from it, with
    **linear** ramps, so the sound dips along with the picture.
  - Muted or 0% clips have no segment; the other side still fades.
- **The mixer applies fades per frame** (`audio/fade.ts`, `audio/mixer.ts`). Outside a fade the
  stream gets a single gain as before; inside, a per-frame gain array (reused, no allocation per
  chunk). Playback and export share the mixer, so they match exactly.

## Consequences

- Old projects need no migration: fades are derived from existing transitions.
- The extended segments make the outgoing clip briefly overlap the incoming one in the mix,
  which is the point; the audio query window is widened to include them.
- Clips with no spare media at the cut get a one-sided fade, as in most editors.
- Independent audio transitions (e.g. on audio-only tracks, or J/L cuts) are not covered yet.

## Alternatives considered

- **Fades as clip properties edited separately:** more state to keep in sync with the video
  transition, for little gain in the common case. Can be added later on top of this model.
- **Linear crossfades:** a 3 dB dip in loudness halfway through for unrelated sounds.
- **Holding the last sample / looping:** audibly wrong; silence beyond the media is better.
- **Applying fades in the AudioWorklet:** would not apply to export, breaking parity.
