# 0004: Decode and composite in a dedicated worker

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Decoding and drawing frames can take several milliseconds. If that happens on the main
thread, dragging clips and scrubbing stutter.

## Decision

The preview canvas is transferred to a render worker with `transferControlToOffscreen()`.
The worker owns all decoders and the compositor. The main thread sends only small "render
these layers" messages. The worker processes **only the latest** pending request.

## Consequences

- The UI stays responsive regardless of decode cost.
- Under load, intermediate frames are skipped instead of queueing up, so scrubbing tracks
  the pointer and playback stays in real time.
- The canvas can only be transferred once, so React StrictMode's double mount is guarded
  with a `WeakSet`.
- WebGPU must be available in workers (it is in all browsers that support WebGPU).

## Alternatives considered

- **Main-thread rendering:** simplest, but blocks input.
- **One worker per asset:** more parallel decoding, but compositing then needs frame
  transfers between workers. We'll revisit if profiling shows decode is the bottleneck with
  many layers.
