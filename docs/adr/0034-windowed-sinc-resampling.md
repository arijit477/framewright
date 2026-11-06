# 0034: Windowed-sinc resampling for playback and export

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Audio files come at many sample rates (22.05, 44.1, 48, 96 kHz…) and are mixed at one rate.
The resampler interpolated linearly between neighbouring samples. That's cheap, but it dulls
high frequencies, adds spurious "image" tones when raising the rate, and lets frequencies a
lower rate can't hold fold back down as aliasing.

## Decision

- **A windowed-sinc mode in the same `Resampler`** (`quality: 'sinc'`):
  - Each output sample is a weighted sum of 48 source samples around it, using a
    Kaiser-windowed sinc (β = 8). The weights come from a 512-phase table, blended linearly
    between phases and normalised so a constant stays exactly constant.
  - The cutoff sits at 94% of the lower Nyquist frequency.
  - When lowering the rate, the cutoff drops with it, so what can't be held is filtered out
    instead of aliasing. The filter widens by the same factor so it stays as sharp.
  - At equal rates, samples pass straight through.
  - Streaming is unchanged: the read position carries across pulls, and the buffer keeps the
    history the filter reads.
- **Measured** in unit tests, as error relative to full scale (the test tone is at −9 dB):

  | Case                          | Linear               | Windowed sinc |
  | ----------------------------- | -------------------- | ------------- |
  | 9 kHz, 22.05 → 48 kHz         | −14.7 dB             | −101.9 dB     |
  | 1 kHz, 44.1 → 48 kHz          | −63.7 dB             | −102.7 dB     |
  | 12 kHz into 16 kHz (aliasing) | −9.0 dB (full level) | −100.7 dB     |
  | 5 kHz, 48 → 16 kHz            | −162 dB (exact 3:1)  | −93.7 dB      |

  We tried 16 samples a side first: −50.5 dB at 9 kHz (too soft a transition near the
  cutoff), and −41 dB at 3:1 before the filter was widened when lowering the rate.
  In an exported MP4, a 9 kHz tone at 22.05 kHz has its 13 050 Hz image 26 dB below it with
  sinc, against 5.5 dB with linear (which also dulls the tone by about 5 dB).

- **Where it's used:** playback and export, so what you hear while editing is what you export.
  It costs about 12 ms per second of stereo audio raising the rate (about 1.2% of a core per
  playing clip) and up to 19 ms when halving it. The analysis jobs (captions, silence) keep
  linear: they measure sound rather than reproduce it, and they process long files at once.

## Consequences

- Clean high frequencies and no aliasing from sources at other rates.
- A few milliseconds of extra work per second of audio per clip.
