import { describe, expect, it } from 'vitest';
import type { TextContent, TextStyle } from '../engine/types';
import {
  activeWord,
  animationState,
  cssColor,
  cssFont,
  layoutText,
  wrapLines,
  wrapWords,
} from './text';

/** A fake font: every character is 10 px wide at any size. */
const tenPx = (text: string) => text.length * 10;

const style = (patch: Partial<TextStyle> = {}): TextStyle => ({
  font: 'sans',
  size: 72,
  color: '#ffffff',
  background: null,
  bold: true,
  italic: false,
  align: 'center',
  x: 500,
  y: 820,
  animationIn: 'fade',
  animationOut: 'fade',
  animationMs: 400,
  ...patch,
});

const S = 1_000_000;

describe('animationState', () => {
  it('fades in, holds, and fades out', () => {
    const s = style();
    expect(animationState(0, 3 * S, s).opacity).toBe(0);
    expect(animationState(0.2 * S, 3 * S, s).opacity).toBeGreaterThan(0.5); // ease-out
    expect(animationState(1.5 * S, 3 * S, s)).toEqual({ opacity: 1, offsetY: 0, scale: 1 });
    expect(animationState(3 * S, 3 * S, s).opacity).toBe(0);
  });

  it('slides up into place and out upwards', () => {
    const s = style({ animationIn: 'slide', animationOut: 'slide' });
    expect(animationState(0, 3 * S, s).offsetY).toBeGreaterThan(0); // starts below
    expect(animationState(3 * S, 3 * S, s).offsetY).toBeLessThan(0); // ends above
  });

  it('pops in from a smaller size', () => {
    const s = style({ animationIn: 'pop', animationOut: 'none' });
    expect(animationState(0, 3 * S, s).scale).toBeCloseTo(0.6);
    expect(animationState(3 * S, 3 * S, s).opacity).toBe(1); // no out animation
  });

  it('shortens animations to fit very short clips', () => {
    const s = style({ animationMs: 2000 });
    // A 1 s clip: in and out get 0.5 s each, so the middle is fully visible.
    expect(animationState(0.5 * S, 1 * S, s).opacity).toBe(1);
  });

  it('shows text immediately with no animation', () => {
    expect(animationState(0, S, style({ animationIn: 'none' })).opacity).toBe(1);
    expect(animationState(0, S, style({ animationMs: 0 })).opacity).toBe(1);
  });
});

describe('wrapLines', () => {
  it('wraps words to the width', () => {
    expect(wrapLines('the quick brown fox', 100, tenPx)).toEqual(['the quick', 'brown fox']);
  });

  it('keeps explicit line breaks and drops extra spaces', () => {
    expect(wrapLines('one\n\ntwo  three', 1000, tenPx)).toEqual(['one', '', 'two three']);
  });

  it('breaks words that are too long for a line', () => {
    expect(wrapLines('abcdefghijkl', 50, tenPx)).toEqual(['abcde', 'fghij', 'kl']);
  });
});

describe('layoutText', () => {
  const content = (text: string, patch: Partial<TextStyle> = {}): TextContent => ({
    text,
    style: style(patch),
  });
  const layout = (c: TextContent, w = 1920, h = 1080) => layoutText(c, w, h, () => tenPx);

  it('centres the block on the anchor point', () => {
    const l = layout(content('Hello', { x: 500, y: 500 }));
    expect(l.left).toBe(960 - 25);
    expect(l.top + l.height / 2).toBe(540);
  });

  it('anchors the top or bottom edge at y, so stacked blocks grow apart', () => {
    const lines = (n: number) => Array.from({ length: n }, () => 'word '.repeat(40)).join(' ');
    for (const n of [1, 3]) {
      const below = layout(content(lines(n), { y: 800, anchorY: 'top' }), 1000, 1000);
      const above = layout(content(lines(n), { y: 800, anchorY: 'bottom' }), 1000, 1000);
      expect(below.top).toBe(800);
      expect(above.top + above.height).toBe(800);
      expect(below.lines.length).toBe(above.lines.length);
    }
  });

  it('anchors left- and right-aligned text at its edge', () => {
    expect(layout(content('Hello', { align: 'left', x: 100 })).left).toBe(192);
    expect(layout(content('Hello', { align: 'right', x: 900 })).left).toBe(1728 - 50);
  });

  it('sizes text by the frame’s short side, so it looks the same in every shape', () => {
    const wide = layout(content('A', { size: 72 }), 1920, 1080).fontPx;
    expect(layout(content('A', { size: 72 }), 1080, 1920).fontPx).toBe(wide);
    expect(layout(content('A', { size: 72 }), 1080, 1080).fontPx).toBe(wide);
  });

  it('scales the font with the frame, so exports at any size match', () => {
    expect(layout(content('A', { size: 72 }), 1920, 1080).fontPx).toBe(72);
    expect(layout(content('A', { size: 72 }), 1280, 720).fontPx).toBe(48);
  });

  it('wraps at 90% of the frame width', () => {
    const l = layout(content('word '.repeat(60)), 1000, 1080);
    expect(l.lines.length).toBeGreaterThan(1);
    expect(Math.max(...l.lines.map((line) => line.width))).toBeLessThanOrEqual(900);
  });
});

describe('fonts and colours', () => {
  it('builds CSS fonts from the style', () => {
    expect(cssFont(style({ bold: false, italic: true, font: 'serif' }), 40)).toMatch(
      /^italic 400 40px "Framewright Serif", Georgia/,
    );
  });

  it('converts #rrggbbaa to rgba', () => {
    expect(cssColor('#00000080')).toBe('rgba(0, 0, 0, 0.502)');
    expect(cssColor('#ff8800')).toBe('#ff8800');
  });
});

describe('word-aware wrapping', () => {
  it('records each word piece and its index across lines and paragraphs', () => {
    // 10 px per character, 60 px lines: "ask not" (70) doesn't fit on one line.
    expect(wrapWords('ask not\nwhat you', 60, tenPx)).toEqual([
      { text: 'ask', pieces: [{ index: 0, from: 0, to: 3 }] },
      { text: 'not', pieces: [{ index: 1, from: 0, to: 3 }] },
      { text: 'what', pieces: [{ index: 2, from: 0, to: 4 }] },
      { text: 'you', pieces: [{ index: 3, from: 0, to: 3 }] },
    ]);
    expect(wrapWords('ab cd', 100, tenPx)).toEqual([
      {
        text: 'ab cd',
        pieces: [
          { index: 0, from: 0, to: 2 },
          { index: 1, from: 3, to: 5 },
        ],
      },
    ]);
  });

  it('keeps one index for a word broken across lines', () => {
    const lines = wrapWords('go extraordinarily', 60, tenPx);
    const pieces = lines.flatMap((l) => l.pieces.map((p) => [p.index, l.text.slice(p.from, p.to)]));
    expect(pieces[0]).toEqual([0, 'go']);
    expect(pieces.slice(1).every(([i]) => i === 1)).toBe(true);
    expect(
      pieces
        .slice(1)
        .map(([, t]) => t)
        .join(''),
    ).toBe('extraordinarily');
  });
});

describe('activeWord', () => {
  const words = [
    { start: 1_000, end: 2_000 },
    { start: 2_000, end: 3_000 },
    { start: 5_000, end: 6_000 },
  ];

  it('is the last word that has started, holding through pauses', () => {
    expect(activeWord(words, 0)).toBe(-1);
    expect(activeWord(words, 1_000)).toBe(0);
    expect(activeWord(words, 2_500)).toBe(1);
    expect(activeWord(words, 4_000)).toBe(1); // a pause: still the last word
    expect(activeWord(words, 9_000)).toBe(2);
    expect(activeWord(undefined, 1_000)).toBe(-1);
  });
});
