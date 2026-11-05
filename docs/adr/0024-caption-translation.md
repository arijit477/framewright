# 0024: Caption translation

- **Status:** Accepted (translation by sentence instead of by caption: [ADR 0025](./0025-sentence-level-translation.md))
- **Date:** 2026-11-05

## Context

Creators publish the same video to audiences in several languages. Captions already come from a
local model (ADR 0021) and are edited as titles; the next step is translating a caption track
without sending text to a cloud service.

## Decision

- **Models: OPUS-MT** (Helsinki-NLP, University of Helsinki), in Transformers.js's ONNX
  conversions `Xenova/opus-mt-<from>-<to>`, at 8-bit (about 110 MB per language pair), on the
  processor, revisions pinned in `captions/translation.ts`.
  - Licences: Apache-2.0, except `ru-en`, `zh-en` and `en-de`, which are CC BY 4.0. Their credit is
    shown in the dialog and in `docs/DEPENDENCIES.md`.
  - Rejected:
    - **NLLB-200:** CC BY-NC (no commercial use).
    - **M2M-100:** MIT, any-to-any, but about 630 MB and slower.
    - **Whisper's built-in translation:** into English only, and it re-listens to the audio
      instead of translating the user's edited text.
- **Routes:**
  - A direct model when one exists (all languages to and from English, plus e.g. Spanish↔French
    and Russian↔Ukrainian).
  - Otherwise through English, using two models (e.g. Hindi → English → Spanish).
  - 24 source and 20 target languages are offered (English included), each only with a route.
  - The dialog states the total download before anything is fetched.
- **What's translated:**
  - The track's titles as they are now, including the user's edits.
  - Each caption separately, as one line.
  - The result is wrapped back into two-line captions.
- **What's produced:** a new top track with one title per original. Each keeps the original's
  time and style, in one undo step. Word timings belong to the original words, so translations
  have none and no word highlight.
- **No target-language tokens.** The multi-target models (`en-ar`, `en-zh`, `en-vi`) document a
  `>>lang<<` prefix. In Transformers.js it is tokenised as text and leaks into the output:
  "汉斯" ("Hans"), stray `>>>…<<<`, "♪ ♪ ♪". Without it they write Modern Standard Arabic,
  simplified Chinese and Vietnamese cleanly (checked on the test recording).
- **A worker per run**, like recognition, sharing its ONNX Runtime setup (`captions/onnx-env.ts`).

## Consequences

- Translation is caption by caption, so a sentence split across two captions is translated in
  halves. For example, "…ask not what your | country can do for you…" loses some fluency. Translating
  whole sentences and redistributing them over the captions' times is a possible follow-up.
- Going through English costs a second download and can lose nuance.
- Translating a long track on the processor takes seconds to a minute; progress is shown per
  model.
