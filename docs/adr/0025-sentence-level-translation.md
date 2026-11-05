# 0025: Sentence-level caption translation

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

ADR 0024 translated each caption on its own. Captions are cut for reading, not for grammar, so a
sentence is often split across two or more captions ("…ask not what your | country can do for
you…"). Translated separately, the halves lose their grammar: the Spanish became "…no preguntan
qué es lo que | país puede hacer por usted…".

## Decision

- **Group captions into sentences** (`captions/sentences.ts`, `sentenceGroups`):
  - Neighbouring captions on the track are joined until one ends with sentence punctuation
    (`. ! ? …` and the CJK forms, allowing closing quotes or brackets).
  - A sentence also ends at a pause of 1 s or more between captions, so unpunctuated speech still
    splits.
  - At most 4 captions or 300 characters per sentence, which keeps the model's input short.
- **Translate each sentence whole**, through the same routes as before (direct, or through
  English).
- **Share the translation back over the captions** (`distribute`):
  - Each caption gets a part in proportion to how much of the original sentence it held, by
    characters.
  - A cut moves to just after punctuation when that's within 8% of the sentence.
  - Every caption gets at least one word. If a translation has fewer words than captions, the
    rest show "…".
  - Chinese, Japanese and Thai have no spaces between words, so they are cut between characters.
- **Times are unchanged:** every caption keeps its exact start and end, as before.

## Consequences

- Sentences read correctly across captions. The Spanish test sentence now contains "qué puede
  hacer su país por usted" whole (the e2e test checks it).
- The words shown in a caption are no longer exactly the words spoken during it. The split is
  proportional, not aligned, so a caption can run slightly ahead of or behind the speech. For
  translated captions this is the usual trade-off: subtitles are translated by sentence, too.
- An unpunctuated run of captions without pauses is translated four at a time.

## Alternatives considered

- **Word alignment between source and translation** (for exact per-word placement): needs
  another model and is unreliable across word orders such as English→Hindi.
- **Merging a sentence's captions into one long caption:** would change the user's timing and
  create captions too long to read.
