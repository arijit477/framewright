# 0021: Local AI auto-captions

- **Status:** Accepted (models and caption shaping updated by [ADR 0022](./0022-word-highlight.md))
- **Date:** 2026-11-04

## Context

Captions are expected in short-form video, and typing them by hand is slow. Cloud speech APIs
cost money per minute and mean uploading the user's audio. The roadmap calls for captions from a
model that runs locally, in the browser.

## Decision

- **Model:** OpenAI's Whisper, as the Transformers.js conversions `Xenova/whisper-tiny` ("Fast",
  ~41 MB) and `Xenova/whisper-base` ("Accurate", ~77 MB, the default), at 8-bit precision
  (Apache-2.0).
  - Revisions are **pinned**, so every user runs the files that were tested.
  - They download from Hugging Face on first use and the browser caches them, so later runs work
    offline. The dialog states the size before anything downloads.
  - (`onnx-community/whisper-*` were considered; the tiny one has no licence in its metadata.)
- **Runtime:** Transformers.js on ONNX Runtime Web (WebAssembly, multi-threaded under
  cross-origin isolation), in a dedicated **captions worker** that is created per run and
  terminated after, so cancelling frees the model and memory immediately. The ONNX Runtime
  engine is **bundled with the app** (a direct, pinned dependency) rather than fetched from a CDN
  at run time; it only loads when captions are first used.
- **What's transcribed:** the project's **mix**: the same mixer as playback and export (ADR 0005),
  at 16 kHz mono, so what's heard is what's captioned (speed, volume and muting included). Long
  audio is processed in ~2-minute blocks, cut at the quietest moment near each boundary, so
  progress is real and no word is cut in half.
- **Silence is skipped** (blocks peaking below about −60 dB): Whisper invents words in silence
  ("you", "Thank you."). The tests caught this directly.
- **Shaping (`captions/segments.ts`, tested):**
  - Whisper's timed phrases become captions of at most two lines of 42 characters, shown for
    0.7–6 s, never overlapping, and inside the timeline.
  - Long phrases are split at word boundaries, preferring sentence ends, with time shared out by
    length.
  - Sound tags like "[Music]" are dropped.
  - Word-level timing needs specially exported models, so v1 uses phrase timing.
- **Result:** captions are ordinary **title clips on a new top track**, added in one undo step and
  styled for legibility (smaller, on a dark box, near the bottom, no fades). Editing, styling,
  moving and deleting them works like any title.
- **Files:** a title's panel saves its track as **SubRip (.srt)** or **WebVTT (.vtt)**
  (`captions/srt.ts`, tested).
- **Tests:** the end-to-end tests transcribe a real recording (JFK's "ask not…", public domain)
  with the real model. A test helper serves Hugging Face files from a disk cache, filled from the
  real site once (and cached in CI), and answers Transformers.js's one-byte size probes as the
  site does.

## Consequences

- Captions cost nothing to run and the audio never leaves the device. They need an internet
  connection the first time, and the browser's storage for the cached model.
- Recognition runs on the CPU (WebAssembly). The tiny model handles an 11 s clip in a few seconds
  in CI. Long projects take a while, with progress shown and Cancel available.
- Transformers.js checks file sizes and its file list against `main` before loading the pinned
  revision. This costs a few bytes plus `config.json`, not a second copy of the model.
- Not yet:
  - word-by-word highlighting (needs word-timestamp models)
  - WebGPU acceleration (needs other model precisions: bigger downloads)
  - translation
  - captioning part of a timeline

## Alternatives considered

- **Cloud speech APIs:** cost per minute, and they upload the user's audio.
- **whisper.cpp in WebAssembly:** fast, but we would maintain the build and model conversion
  ourselves, and it doesn't move to WebGPU as easily.
- **Captions as a separate clip type:** more model and UI surface. Titles already render, edit,
  export and undo.
