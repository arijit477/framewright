# 0038: Bundled fonts for titles

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Titles and captions used generic system font stacks (`system-ui`, Georgia, …). These are
available inside workers, so the export worker could draw text, but they differ from machine to
machine: a title looked different on another computer, and a "handwriting" title could be Comic
Sans on one machine and Segoe Print on another. CSS `@font-face` fonts don't help, because the
preview and export draw text in workers, which don't see the page's stylesheets.

## Decision

- **Five bundled, OFL-licensed families** from @fontsource, one per font choice: Sans (Inter),
  Serif (Playfair Display), Mono (JetBrains Mono), Handwriting (Caveat) and a new Display
  (Bebas Neue). The variable versions cover bold with one file, and italic files are used where
  the family has them.
- **Registered under our own names** ("Framewright Sans", …) at the front of each stack, so an
  installed copy of the same font never stands in for ours. System fonts stay behind them, for
  characters the bundled files don't cover (such as Chinese or Arabic).
- **Each thread that draws text loads fonts into its own font set** (`self.fonts` in a worker)
  as `FontFace`s (`render/fonts.ts`). Fonts are split by script into files, each with its
  `unicode-range`. Only the files covering a title's characters are loaded, each once.
- **Drawing waits for its fonts.** The preview and export workers check the frame's text before
  compositing. After the first frame, the check returns at once. A file that fails to load is
  logged and not retried, and the text draws in the fallback fonts.
- `src/render/font-files.ts` is generated from the packages' CSS by `scripts/fonts.mjs`, so the
  unicode ranges are never copied by hand.

## Consequences

- A title looks the same in the preview, in the export and on every machine. Existing projects
  keep their font choice, now drawn with the bundled face instead of a system font.
- The fonts add about 1 MB of files to the build, but a title only fetches the few that cover
  its characters (typically one file of 10–75 kB per style).
- The test exports the same word in Display and in Sans and compares their widths. Without the
  bundled fonts, both fall back to the same system font and the widths match.
