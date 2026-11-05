# 0027: Translation stays on the processor

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Speech recognition runs on the graphics card when there is one (ADR 0023). Running caption
translation (ADR 0024, ADR 0025) there too was the next item. We measured before building it.

## Measurements

The benchmark (`e2e/translation-bench.spec.ts`, opt-in with `BENCH=1`) uses `jfk.wav` repeated 30
times: 5.5 minutes, 61 captions, about 30 sentences. It translates them English→Spanish on the
processor, in headless Chromium in a CI-class container.

| Sentences per model call | Time (model cached) |
| ------------------------ | ------------------- |
| 4                        | 19 s                |
| 8 (before)               | 11.6–12 s           |
| 16                       | 9–10.5 s            |
| 32                       | 9.5 s               |

On first use, the model download adds about 6–7 s here. Speech recognition of the same file
takes over a minute, so translation is already the short step: about 2 s per minute of video.

## Decision

- **Translate 16 sentences per model call** (was 8): about 20% faster, with no other cost.
- **No WebGPU path for translation, for now:**
  - **The download would grow 2.4–4×.** The 8-bit OPUS-MT files use integer operators that ONNX
    Runtime's WebGPU backend doesn't implement (as for Whisper, ADR 0023). A real GPU path needs a
    full-precision encoder (262 MB per pair with an 8-bit decoder, 433 MB all full precision)
    instead of 110 MB, doubled when translating through English.
  - **The gain is doubtful.** These models are small (about 75M parameters), and their time goes
    mostly into the decoder's word-by-word steps, where per-step GPU overhead often makes WebGPU
    no faster, or slower, than WebAssembly. (Whisper gained because its large encoder runs once
    per 30 s of audio.)
  - **It can't be verified here.** Our test adapter is a software GPU (SwiftShader), slower than
    the processor.

## Consequences

- Translation keeps the 110 MB download per pair and works the same everywhere.
- To revisit:
  - WebGPU-friendly quantised translation models become available (e.g. 4-bit with WebGPU
    kernels), or
  - users translate long videos often enough for ~2 s per minute to matter.

  The benchmark spec makes either measurable.
