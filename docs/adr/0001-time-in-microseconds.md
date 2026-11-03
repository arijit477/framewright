# 0001: Represent time as integer microseconds

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Editors constantly add, subtract and compare times. Floating-point seconds accumulate
rounding error (after many splits, `0.1 + 0.2 != 0.3` style bugs put clips one frame off).
Frame numbers alone don't work either, because sources have different frame rates
(23.976, 25, 29.97, 30, 60, variable).

## Decision

All timeline times are integer microseconds (`i64` in Rust, `number` in TS, exact to 2^53).
This is the unit WebCodecs uses for `VideoFrame.timestamp`, so there is no conversion at the
decoder boundary. UI frame stepping converts from frame indices with `framesToMicros(n)`,
never by repeatedly adding a rounded frame duration.

## Consequences

- Edits are exact and deterministic, and therefore easy to test.
- A 30 fps frame is 33,333.3 µs, so frame boundaries are rounded to the nearest µs. Display
  code uses a small tolerance when converting back to frame numbers.
- JS ↔ WASM passes `f64`, rounded on the Rust side, to avoid `BigInt` in UI code.

## Alternatives considered

- **Float seconds:** simple, but drifts.
- **Rational time (like `CMTime`):** exact for any frame rate, but heavier for every
  operation and unnecessary at µs precision.
