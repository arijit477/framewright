# 0006: Export reuses the preview pipeline in a per-job worker

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Users expect the exported file to match the preview exactly. Export must not freeze the
editor, must be cancellable, and must not leak memory between runs. Browsers differ in which
encoders they ship (for example, open-source Chromium has no AAC encoder).

## Decision

- Export runs in a **new worker per job**. The worker loads its own `TimelineEngine` from the
  project JSON (a snapshot) and is terminated when the job ends.
- It reuses the preview's components: `resolve(t)`, `FrameReader`, the `Compositor` and the
  `Mixer`. The mixer was extracted from the audio worker for this, so playback and export
  share one tested implementation.
- Codecs are chosen at runtime with `getFirstEncodable*Codec` from a preference list per
  container. A missing audio encoder produces a silent file and a visible warning rather than
  a failed export.
- Export composites with **Canvas 2D**. `CanvasSource` reads frames back from the canvas;
  that path is supported everywhere and is the one our tests verify. WebGPU export is a later
  optimisation (roadmap), to be enabled once it can be verified on real GPUs in CI.
- The output is assembled in memory (`BufferTarget`) with MP4 fast start.

## Consequences

- Preview and export can't diverge: same engine, same decoder logic, same mixer.
- Users can keep editing during an export.
- Cancelling or failing always releases resources (worker termination).
- Very long or 4K exports are limited by memory until streaming to disk is added.
- Canvas 2D compositing is slower than WebGPU for multi-layer 4K. Encoding is usually the
  bottleneck anyway.

## Alternatives considered

- **Render on the main thread:** blocks the UI.
- **Reuse the preview render worker:** export would compete with scrubbing, and a failure could
  take down the preview.
- **FFmpeg.wasm for encoding:** slow (no hardware encoders) and GPL in its default build.
