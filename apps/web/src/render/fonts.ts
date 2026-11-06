import type { FontFamily } from '../engine/types';
import type { DrawItem } from './compositor';

/**
 * Bundled fonts (OFL-licensed, from @fontsource), so a title looks the same in
 * the preview, in the export and on every machine. Workers can't use CSS
 * `@font-face`, so each thread that draws text adds `FontFace`s to its own
 * font set, loading only the files that cover the characters it draws.
 */

/** One font file: a family's style over a range of characters. */
export interface FontFile {
  family: FontFamily;
  style: string;
  /** A weight or a variable range ("100 900"). */
  weight: string;
  /** CSS `unicode-range`, e.g. "U+0000-00FF,U+0131". */
  unicodeRange: string;
  url: string;
}

/** The names the bundled faces are registered under (distinct from installed fonts). */
export const FONT_NAMES: Record<FontFamily, string> = {
  sans: 'Framewright Sans',
  serif: 'Framewright Serif',
  mono: 'Framewright Mono',
  handwriting: 'Framewright Handwriting',
  display: 'Framewright Display',
};

/** Each bundled font, then system fonts for characters it doesn't have (e.g. CJK). */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: `"${FONT_NAMES.sans}", system-ui, "Helvetica Neue", Arial, sans-serif`,
  serif: `"${FONT_NAMES.serif}", Georgia, "Times New Roman", serif`,
  mono: `"${FONT_NAMES.mono}", ui-monospace, Menlo, Consolas, monospace`,
  handwriting: `"${FONT_NAMES.handwriting}", "Segoe Print", "Bradley Hand", cursive`,
  display: `"${FONT_NAMES.display}", Impact, "Arial Narrow", sans-serif`,
};

/** Parse a CSS `unicode-range` into inclusive [from, to] code point ranges. */
export function parseUnicodeRange(range: string): [number, number][] {
  return range.split(',').map((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(from!, 16), parseInt(to!, 16)];
  });
}

/**
 * The files a run of text in `family` needs: those covering at least one of its
 * characters, in the italic style if the family has one (otherwise the browser
 * slants the upright face).
 */
export function filesFor(
  files: readonly FontFile[],
  family: FontFamily,
  italic: boolean,
  text: string,
): FontFile[] {
  const own = files.filter((f) => f.family === family);
  const hasItalic = own.some((f) => f.style === 'italic');
  const style = italic && hasItalic ? 'italic' : 'normal';
  const codePoints = new Set<number>();
  for (const char of text) codePoints.add(char.codePointAt(0)!);
  return own.filter(
    (f) =>
      f.style === style &&
      parseUnicodeRange(f.unicodeRange).some(([from, to]) => {
        for (const cp of codePoints) if (cp >= from && cp <= to) return true;
        return false;
      }),
  );
}

/** The part of a `FontFaceSet` used here (the document's, or a worker's `self.fonts`). */
export interface FontTarget {
  add(face: FontFace): unknown;
}

/**
 * Loads bundled font files into one thread's font set, each file once.
 * `ready` is synchronous-fast when everything needed is already there, so the
 * per-frame check costs nothing after the first frame.
 */
export class FontLoader {
  private readonly loads = new Map<string, Promise<void>>();
  private readonly done = new Set<string>();

  constructor(
    private readonly target: FontTarget,
    private readonly files: readonly FontFile[],
    private readonly makeFace: (file: FontFile) => FontFace = (file) =>
      new FontFace(FONT_NAMES[file.family], `url(${file.url})`, {
        style: file.style,
        weight: file.weight,
        unicodeRange: file.unicodeRange,
      }),
  ) {}

  /** Null when every file these texts need is loaded; otherwise a promise for them. */
  ready(
    texts: Iterable<{ family: FontFamily; italic: boolean; text: string }>,
  ): Promise<void> | null {
    const waits: Promise<void>[] = [];
    for (const { family, italic, text } of texts) {
      for (const file of filesFor(this.files, family, italic, text)) {
        if (this.done.has(file.url)) continue;
        waits.push(this.load(file));
      }
    }
    return waits.length > 0 ? Promise.all(waits).then(() => {}) : null;
  }

  private load(file: FontFile): Promise<void> {
    let loading = this.loads.get(file.url);
    if (!loading) {
      loading = (async () => {
        try {
          const face = this.makeFace(file);
          this.target.add(face);
          await face.load();
        } catch (error) {
          // Text still draws, in the fallback fonts of the stack.
          console.warn(`Font ${file.url} failed to load`, error);
        } finally {
          this.done.add(file.url);
        }
      })();
      this.loads.set(file.url, loading);
    }
    return loading;
  }
}

/** What the text layers among `items` draw, for `FontLoader.ready`. */
export function textRuns(items: readonly DrawItem[]) {
  return items.flatMap((item) =>
    item.kind === 'text'
      ? [
          {
            family: item.content.style.font,
            italic: item.content.style.italic,
            text: item.content.text,
          },
        ]
      : [],
  );
}
