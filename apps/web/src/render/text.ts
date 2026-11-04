import type { FontFamily, TextContent, TextStyle, WordTiming } from '../engine/types';

/**
 * Text overlay rendering, shared by every compositor and by export, so a title
 * looks the same in the preview and in the exported file.
 *
 * Styles are defined on a 1080p frame and scaled to the actual canvas, so the
 * layout is resolution-independent.
 */

/** Reference frame height the style's sizes are defined on. */
export const REFERENCE_HEIGHT = 1080;
/** Text wraps at this fraction of the frame width. */
export const MAX_WIDTH_FRACTION = 0.9;
const LINE_HEIGHT = 1.2;
/** Background box padding, in ems. */
const BOX_PADDING_X = 0.4;
const BOX_PADDING_Y = 0.15;

/**
 * Generic font stacks. Exports must render with fonts available inside
 * workers, so these use installed system fonts with a CSS generic fallback.
 */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: 'system-ui, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  handwriting: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
};

export function cssFont(style: TextStyle, px: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700' : '400'} ${px}px ${FONT_STACKS[style.font]}`;
}

export interface AnimationState {
  opacity: number;
  /** Vertical offset as a fraction of the frame height (positive = down). */
  offsetY: number;
  scale: number;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * How the text looks at `clipTimeUs` into a clip of `clipDurationUs`: the in
 * animation over its first `animationMs`, the out animation over its last.
 * Both are shortened to half the clip if it's too short for them.
 */
export function animationState(
  clipTimeUs: number,
  clipDurationUs: number,
  style: Pick<TextStyle, 'animationIn' | 'animationOut' | 'animationMs'>,
): AnimationState {
  const length = Math.min(style.animationMs * 1000, clipDurationUs / 2);
  const inProgress = length > 0 ? easeOutCubic(clamp01(clipTimeUs / length)) : 1;
  const outProgress =
    length > 0 ? easeOutCubic(clamp01((clipDurationUs - clipTimeUs) / length)) : 1;
  const enter = phase(style.animationIn, inProgress, 1);
  const exit = phase(style.animationOut, outProgress, -1);
  return {
    opacity: enter.opacity * exit.opacity,
    offsetY: enter.offsetY + exit.offsetY,
    scale: enter.scale * exit.scale,
  };
}

/** One side of an animation; `direction` 1 enters from below, -1 leaves upwards. */
function phase(
  kind: TextStyle['animationIn'],
  progress: number,
  direction: 1 | -1,
): AnimationState {
  switch (kind) {
    case 'none':
      return { opacity: 1, offsetY: 0, scale: 1 };
    case 'fade':
      return { opacity: progress, offsetY: 0, scale: 1 };
    case 'slide':
      return { opacity: progress, offsetY: (1 - progress) * 0.04 * direction, scale: 1 };
    case 'pop':
      return { opacity: progress, offsetY: 0, scale: 0.6 + 0.4 * progress };
  }
}

export type Measure = (text: string) => number;

/**
 * Greedy word wrap within `maxWidth`. Explicit line breaks are kept; a word
 * wider than the line is broken between characters.
 */
export function wrapLines(text: string, maxWidth: number, measure: Measure): string[] {
  return wrapWords(text, maxWidth, measure).map((line) => line.text);
}

/** Where a word (or the part of one that fits on this line) sits in a line's text. */
export interface WordPiece {
  /** Index of the word in the whole text (whitespace-separated, like the engine). */
  index: number;
  from: number;
  to: number;
}

/**
 * Wrap text into lines that fit `maxWidth`, at spaces and line breaks; a word
 * too wide on its own is broken. Each line lists its word pieces, so the word
 * being spoken can be highlighted wherever wrapping put it.
 */
export function wrapWords(
  text: string,
  maxWidth: number,
  measure: Measure,
): { text: string; pieces: WordPiece[] }[] {
  const lines: { text: string; pieces: WordPiece[] }[] = [];
  let index = 0;
  for (const paragraph of text.split('\n')) {
    let line = '';
    let pieces: WordPiece[] = [];
    const add = (part: string) => {
      const from = line ? line.length + 1 : 0;
      line = line ? `${line} ${part}` : part;
      pieces.push({ index, from, to: from + part.length });
    };
    const flush = () => {
      lines.push({ text: line, pieces });
      line = '';
      pieces = [];
    };
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (measure(line ? `${line} ${word}` : word) <= maxWidth) {
        add(word);
        index++;
        continue;
      }
      if (line) flush();
      // The word alone may still be too wide: break it.
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
        add(rest.slice(0, cut));
        flush();
        rest = rest.slice(cut);
      }
      add(rest);
      index++;
    }
    flush();
  }
  return lines;
}

/**
 * The word being spoken at `sourceTimeUs`: the last one that has started, so
 * the highlight stays put through pauses. -1 before the first word.
 */
export function activeWord(words: readonly WordTiming[] | undefined, sourceTimeUs: number): number {
  if (!words) return -1;
  let active = -1;
  for (let i = 0; i < words.length && words[i]!.start <= sourceTimeUs; i++) active = i;
  return active;
}

export interface TextLayout {
  font: string;
  fontPx: number;
  lineHeightPx: number;
  lines: { text: string; width: number; pieces: WordPiece[] }[];
  /** Block bounds in canvas pixels (before animation). */
  left: number;
  top: number;
  width: number;
  height: number;
  align: TextStyle['align'];
  /** The x each line is drawn at (with `textAlign = align`). */
  anchorX: number;
}

/** Where every line goes on a `width`×`height` canvas. */
export function layoutText(
  content: TextContent,
  width: number,
  height: number,
  measureWith: (font: string) => Measure,
): TextLayout {
  const { style } = content;
  const fontPx = (style.size * height) / REFERENCE_HEIGHT;
  const font = cssFont(style, fontPx);
  const measure = measureWith(font);
  const lines = wrapWords(content.text, width * MAX_WIDTH_FRACTION, measure).map((line) => ({
    ...line,
    width: measure(line.text),
  }));
  const lineHeightPx = fontPx * LINE_HEIGHT;
  const blockWidth = Math.max(0, ...lines.map((l) => l.width));
  const blockHeight = lines.length * lineHeightPx;
  const anchorX = (style.x / 1000) * width;
  const left =
    style.align === 'left'
      ? anchorX
      : style.align === 'right'
        ? anchorX - blockWidth
        : anchorX - blockWidth / 2;
  const top = (style.y / 1000) * height - blockHeight / 2;
  return {
    font,
    fontPx,
    lineHeightPx,
    lines,
    left,
    top,
    width: blockWidth,
    height: blockHeight,
    align: style.align,
    anchorX,
  };
}

/** The subset of the 2D canvas API used to draw text (works for OffscreenCanvas too). */
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draw a text clip at `clipTimeUs` onto a canvas of the given size. With word
 * timings and a highlight colour, the word being spoken at `sourceTimeUs` (the
 * clip's source time) is drawn in that colour.
 */
export function drawText(
  ctx: Canvas2D,
  content: TextContent,
  clipTimeUs: number,
  clipDurationUs: number,
  width: number,
  height: number,
  sourceTimeUs = clipTimeUs,
): void {
  const state = animationState(clipTimeUs, clipDurationUs, content.style);
  if (state.opacity <= 0.001) return;
  const layout = layoutText(content, width, height, (font) => {
    ctx.font = font;
    return (text) => ctx.measureText(text).width;
  });

  ctx.save();
  ctx.globalAlpha = state.opacity;
  // Animate around the block's centre.
  const centreX = layout.left + layout.width / 2;
  const centreY = layout.top + layout.height / 2 + state.offsetY * height;
  ctx.translate(centreX, centreY);
  ctx.scale(state.scale, state.scale);
  ctx.translate(-centreX, -(layout.top + layout.height / 2));

  const { style } = content;
  if (style.background) {
    const padX = layout.fontPx * BOX_PADDING_X;
    const padY = layout.fontPx * BOX_PADDING_Y;
    ctx.fillStyle = cssColor(style.background);
    ctx.beginPath();
    ctx.roundRect(
      layout.left - padX,
      layout.top - padY,
      layout.width + padX * 2,
      layout.height + padY * 2,
      layout.fontPx * 0.2,
    );
    ctx.fill();
  } else {
    // No box: a soft shadow keeps text legible on any footage.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = layout.fontPx * 0.12;
    ctx.shadowOffsetY = layout.fontPx * 0.03;
  }

  ctx.font = layout.font;
  ctx.fillStyle = style.color;
  ctx.textAlign = layout.align;
  ctx.textBaseline = 'middle';
  const spoken = style.highlight ? activeWord(content.words, sourceTimeUs) : -1;
  layout.lines.forEach((line, i) => {
    const y = layout.top + layout.lineHeightPx * (i + 0.5);
    const piece = line.pieces.find((p) => p.index === spoken);
    if (!piece) {
      ctx.fillText(line.text, layout.anchorX, y);
      return;
    }
    // Draw the line in three parts, left to right, so the spoken word gets its own colour.
    const start =
      layout.align === 'left'
        ? layout.anchorX
        : layout.align === 'right'
          ? layout.anchorX - line.width
          : layout.anchorX - line.width / 2;
    const before = line.text.slice(0, piece.from);
    const word = line.text.slice(piece.from, piece.to);
    const after = line.text.slice(piece.to);
    const wordX = start + ctx.measureText(before).width;
    const afterX = start + ctx.measureText(line.text.slice(0, piece.to)).width;
    ctx.textAlign = 'left';
    ctx.fillText(before, start, y);
    ctx.fillText(after, afterX, y);
    ctx.fillStyle = style.highlight!;
    ctx.fillText(word, wordX, y);
    ctx.fillStyle = style.color;
    ctx.textAlign = layout.align;
  });
  ctx.restore();
}

/** `#rrggbbaa` → `rgba(...)`; `#rrggbb` passes through. */
export function cssColor(hex: string): string {
  if (hex.length !== 9) return hex;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${(n(7) / 255).toFixed(3)})`;
}
