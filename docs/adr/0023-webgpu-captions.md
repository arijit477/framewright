# 0023: Speech recognition on the graphics card (WebGPU)

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Auto captions (ADR 0021, ADR 0022) run Whisper on the processor through ONNX Runtime's
WebAssembly backend. That's fine for short clips but slow for long ones, and most of the work is
dense matrix maths that graphics cards do far faster. Browsers expose the graphics card through
WebGPU, which ONNX Runtime Web supports.

## Decision

- **Split the model across devices.** Whisper's **encoder** (most of the work: once per 30 s of
  audio) runs on the graphics card; the **decoder** (one small step per word piece, which suits
  a processor) stays on the processor. Transformers.js loads each file on its own device.
- **The GPU encoder is full precision (fp32).** ONNX Runtime's WebGPU backend has no kernels for
  the integer operators in the 8-bit files (`MatMulInteger`, `ConvInteger`,
  `DynamicQuantizeLinear`), so an 8-bit model on WebGPU _works_ but silently runs its matrix
  maths on the processor: no faster. We checked every operator in the fp32 encoder against ONNX
  Runtime's WebGPU kernel list; all are supported. The decoder stays 8-bit, the same file as
  processor runs, so it's shared in the browser's cache.
  - Downloads: Fast 64 MB (processor: 41 MB), Accurate 136 MB (processor: 77 MB). The dialog
    shows the size for the device that will be used.
  - Rejected: a 4-bit decoder on the GPU (crashed the browser on the software adapter we test
    with); fp16 (needs `shader-f16`, which the test adapter lacks, so it couldn't be tested).
- **On by default when the browser offers an adapter**, with a "Use the graphics card" option in
  the Captions dialog (remembered). Without WebGPU the option isn't shown and nothing changes.
- **Falls back to the processor** if the graphics card can't load or run the model (no adapter,
  unsupported card, device lost): the run restarts on the processor **in a fresh worker**,
  because a failed GPU session can leave the old worker's runtime unusable (we saw this). The
  dialog says so while it runs and the final message repeats it.
- **One ONNX Runtime build for both.** The app now bundles ONNX Runtime's `asyncify` build, which
  contains both the WebAssembly and the WebGPU backends (the previously bundled `jsep` build
  lacks this version's WebGPU backend). It's also slightly smaller (26.9 vs 28.4 MB).

## Consequences

- On machines with a graphics card, recognition should be considerably faster. **We could not
  measure the speed-up on real hardware here** (tests use Chromium's software adapter,
  SwiftShader, which is slower than the processor); the tests check that the GPU path is used and
  gives correct captions with word timings, not its speed.
- GPU runs download the larger, full-precision encoder once.
- If the GPU fails, the audio is mixed again in the new worker (a few seconds at most).

## Alternatives considered

- **8-bit files on WebGPU:** no extra download, but no real acceleration (see above).
- **Everything on the GPU:** the decoder's many tiny steps gain little and the 4-bit decoder was
  unstable on the test adapter.
- **WebNN:** not yet broadly available in browsers.
