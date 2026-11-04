# 0016: Speed control with pitch-preserving audio

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Editors need slow motion and fast-forward per clip. Changing speed affects every place that maps
timeline time to source time: decoding, trimming, splitting, keyframes, transitions and audio.
Sped-up sound must keep its pitch (no "chipmunk" voices), and preview and export must match.

## Decision

- **A clip's `speedPercent`** (25–400, omitted at 100). `duration` stays the length on the
  timeline; it covers `duration × speed` of media. Changing the speed keeps the same media, so
  the clip gets shorter when faster. Slowing a clip down when the next clip is in the way is
  refused with a clear message, rather than overlapping or silently trimming. Ripple editing is
  a separate roadmap item.
- **One mapping in the engine** (`Clip::source_at`, `to_source`, `to_timeline`, rounded to the
  microsecond). Layers, keyframes, splits, trims and transition extensions all go through it. The
  longest allowed duration is rounded _down_, so a clip can never reach past its media.
- **Video needs nothing new:** the decoder already shows the frame for any source time.
- **Audio:** segments carry `speed`. The mixer opens streams at the right source time and speed,
  and `SourceStream` passes resampled audio through a **WSOLA time-stretcher**
  (`audio/time-stretch.ts`): 40 ms Hann windows at 50% overlap, each nudged within ±12 ms to the
  best waveform match, so the pitch is kept. Playback and export share it.

## Consequences

- Old projects are unaffected.
- The time-stretcher's search costs roughly 30M multiply-adds per second of sped-up audio in the
  audio worker, well within budget. Speed 1 bypasses it entirely.
- WSOLA suits speech and most music. Strongly percussive material can smear slightly at extreme
  speeds; a phase vocoder could be added later behind the same interface.
- Not yet: speed ramps (keyframed speed), reverse playback, and ripple when slowing down.

## Alternatives considered

- **Resampling the audio (pitch follows speed):** trivial, but sounds wrong for speech.
- **Storing source duration instead of timeline duration:** every timeline operation (snapping,
  overlap, transitions) works in timeline time, so the timeline length is the natural field.
- **A WebAssembly time-stretch library:** heavier to ship and license-check. WSOLA is small and
  fully tested here.
