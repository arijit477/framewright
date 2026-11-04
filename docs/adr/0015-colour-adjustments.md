# 0015: Colour adjustments (filters)

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Editors need basic colour correction and quick looks (black and white, vivid, moody). Three
paths draw video: the WebGPU preview, the Canvas 2D preview (fallback), and the Canvas 2D export.
They must produce the same colours, or what you see is not what you export.

## Decision

- **Three adjustments per media clip:** brightness, contrast and saturation, stored as integers
  from -100 to 100 (`ColorAdjust` in `color.rs`, omitted when neutral, kept on split). Looks
  are presets that just set the three values, so they stay editable.
- **The maths is the CSS filter functions** `brightness()`, `contrast()`, `saturate()`, in that
  order on sRGB values, clamping after each step (Filter Effects spec), with the stored values
  mapped by `colorParams()` (brightness ±50%, contrast and saturation 0–2×).
  - **Canvas 2D** sets `ctx.filter`, so the browser does the work (GPU-accelerated where
    available).
  - **WebGPU** implements the same steps in the fragment shader (three more uniform floats).
  - **Without canvas filters** (detected before use), pixels are adjusted in JavaScript, which is
    slow but exact.
  - `adjustRgb()` in `render/color.ts` is the reference, unit-tested. The e2e test checks that a
    Canvas 2D export matches it (measured within about 1/255). The WebGPU self-test draws a
    desaturated frame and checks the expected grey, so a shader that disagreed would fall back to
    Canvas 2D rather than show different colours.

## Consequences

- Old projects are unaffected.
- Canvas 2D filters cost time where they run in software: about +40 ms per 1080p frame in the
  GPU-less CI sandbox. On real hardware they're GPU-accelerated, and most browsers preview with
  WebGPU.
- Not yet: keyframed colour and adjustments on titles. (LUTs followed in ADR 0019, and
  temperature/tint in the addendum below.)

## Alternatives considered

- **A 4×5 colour matrix:** one multiply, but it can't reproduce CSS's per-step clamping, so Canvas
  2D and WebGPU would differ at the extremes.
- **Always adjusting pixels in JavaScript for Canvas 2D:** identical everywhere, but far too slow
  for preview.
- **Linear-light maths:** more "correct", but no Canvas 2D equivalent, so the paths would differ.

## Addendum: white balance (temperature and tint)

- `ColorAdjust` gains `temperature` and `tint` (-100 to 100, default 0, so older projects read as
  unchanged).
- **They are per-channel gains:** warmer raises red and lowers blue, more magenta lowers green, by
  up to 25%. The gains are divided by the luma of white (relative to unchanged white), so the
  overall brightness stays the same.
- **Pipeline order, in every renderer:** white balance (a correction of the footage), then the
  LUT, then brightness/contrast/saturation. The clip panel shows the controls in that order.
- **No CSS filter does per-channel gains,** so Canvas 2D applies white balance in its JavaScript
  pixel pass (shared with LUTs). The WebGPU shader multiplies by three more uniform floats.
- **WebGPU self-test:** it now runs red through white balance, an inverting LUT and
  desaturation, and compares the result with the value the TypeScript reference computes. A unit
  test proves every wrong order (or a missing step) would read back something else.
- **Cost:** a clip with white balance takes the Canvas 2D pixel path, with the same cost as a LUT
  (ADR 0019). Warm and Cool looks were added.
