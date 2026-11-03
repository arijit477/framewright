# 0005: Audio is the master clock, fed by a shared-memory ring buffer

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

During playback, picture and sound must stay in sync for minutes at a time. Video frames can be
dropped without anyone noticing, but audio cannot: any gap is an audible click. The audio
thread has a hard real-time deadline (128 frames every 2.7 ms at 48 kHz), so it can't wait on
decoding or on messages from other threads.

## Decision

- The **audio output drives time**. The AudioWorklet's count of frames played, mapped through
  an anchor (frame N = timeline time T), is the playhead. Video asks the clock which frame to
  show.
- Decoding, resampling and mixing happen in a **dedicated audio worker** that keeps a
  `SharedArrayBuffer` ring about 250 ms ahead.
- The ring is **lock-free SPSC** with monotonic indices. Flushes are requested by the writer and
  performed by the reader, so each index has exactly one writer.
- Volume is stored as an **integer percent** in the engine so projects compare and serialise
  exactly. It becomes a float gain only in `audioSegments()`.

## Consequences

- A/V sync is exact: video can never run ahead of the sound being heard. Underruns pause the
  clock instead of causing drift.
- The worklet is tiny, allocation-free and message-free on the hot path.
- Requires cross-origin isolation for `SharedArrayBuffer`. We already require it; there's a
  wall-clock fallback without sound.
- Browsers only start audio after a user gesture. Play is always triggered by a click or key,
  and a watchdog falls back to the wall clock if output never starts.
- Edits during playback take effect after a short re-mix (about 250 ms of buffered audio is
  discarded).

## Alternatives considered

- **Wall clock with audio scheduled via `AudioBufferSourceNode`s:** simple, but the two clocks
  drift apart, and scheduling many small buffers is fragile.
- **Decode whole files to `AudioBuffer`s up front:** about 380 kB per second of stereo audio;
  a 10-minute project could need hundreds of MB.
- **Worklet ↔ worker `MessagePort`:** messages allocate and can be delayed by GC on the audio
  thread; shared memory can't.
