import type { FontFamily, TextContent, TextStyle } from '../engine/types';

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
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // The word alone may still be too wide: break it.
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export interface TextLayout {
  font: string;
  fontPx: number;
  lineHeightPx: number;
  lines: { text: string; width: number }[];
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
  const lines = wrapLines(content.text, width * MAX_WIDTH_FRACTION, measure).map((text) => ({
    text,
    width: measure(text),
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

/** Draw a text clip at `clipTimeUs` onto a canvas of the given size. */
export function drawText(
  ctx: Canvas2D,
  content: TextContent,
  clipTimeUs: number,
  clipDurationUs: number,
  width: number,
  height: number,
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
  layout.lines.forEach((line, i) => {
    ctx.fillText(line.text, layout.anchorX, layout.top + layout.lineHeightPx * (i + 0.5));
  });
  ctx.restore();
}

/** `#rrggbbaa` → `rgba(...)`; `#rrggbb` passes through. */
export function cssColor(hex: string): string {
  if (hex.length !== 9) return hex;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${(n(7) / 255).toFixed(3)})`;
}
