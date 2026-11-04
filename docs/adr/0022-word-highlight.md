# 0022: Word-by-word caption highlighting

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Short-form captions commonly light up each word as it's spoken. That needs the time of every
word, which the phrase-level timestamps from ADR 0021 don't give, and it has to survive
everything else the editor does to a caption: trimming, splitting, moving, speed changes and
fixing a misheard word.

## Decision

- **Word timestamps from Whisper's cross-attention** (`return_timestamps: 'word'`). That needs
  model exports that include the attention heads, so the models move from `Xenova/whisper-*` to
  `onnx-community/whisper-tiny_timestamped` and `onnx-community/whisper-base_timestamped` (same
  sizes, 8-bit, revisions pinned in `captions/protocol.ts`).
  - **Licence:** these repos don't declare one in their metadata. They declare `openai/whisper-*`
    as their base model, which is Apache-2.0 (OpenAI's original release: MIT), and a conversion to
    another format doesn't change the weights' licence. We record that reasoning in
    `DEPENDENCIES.md` and will revisit if the repos ever state a different licence.
- **Captions are built from words** (`captions/segments.ts`, `captionsFromWords`): a caption ends
  when it would exceed two lines of 42 characters or 6 s, after a pause of 1 s or more, or at the
  end of a sentence once it's long enough to read. Captions are therefore cut where speech
  breaks, not at arbitrary points inside a Whisper phrase.
- **Stored on the text clip** as `words: [{ start, end }]` (one per whitespace-separated word, in
  µs of the clip's **source time**), plus `style.highlight` (`#rrggbb`, absent = off). Source time
  is what keyframes use (ADR 0014), so trimming, splitting and speed changes keep every word
  aligned with no extra code; the engine validates that the count matches the text and that
  times are in order. Projects without word timings save byte-for-byte as before.
- **Rendering:** `drawText` (shared by preview and export, ADR 0010) wraps by word, knows which
  word each piece of each line is, and draws the word being spoken in the highlight colour. The
  highlight **holds through pauses** (the last word started stays lit) so it doesn't flicker
  between words.
- **Editing text:** an edit that keeps the number of words (correcting a misheard word) keeps the
  timings. One that adds or removes words **drops** them, with a notice, because there is no
  honest way to time the new words; undo brings them back.
- **On by default** for new captions in the default yellow (`#facc15`); the captions dialog can
  turn it off, and the text inspector can change the colour or turn it off per caption.

## Consequences

- Highlighting is exactly in sync in the export, because it's computed from the frame's source
  time like everything else.
- Turning one caption into two words-worth of edits (e.g. adding a word) loses that caption's
  highlighting; re-running captions restores it. Proportionally re-timing new words was rejected
  as it would look right while being wrong.
- Word timings add a few dozen bytes per caption to the project.

## Alternatives considered

- **Splitting each caption's time evenly across its words:** no model change, but visibly out of
  sync on any natural speech.
- **Keeping `Xenova/whisper-*`:** they lack the alignment heads Transformers.js needs for word
  timestamps.
- **Storing word times in timeline time:** every trim, split, move and speed change would need to
  rewrite them.
