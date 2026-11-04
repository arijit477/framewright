import { describe, expect, it } from 'vitest';
import type { TextContent, TextStyle } from '../engine/types';
import { animationState, cssColor, cssFont, layoutText, wrapLines } from './text';

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

  it('anchors left- and right-aligned text at its edge', () => {
    expect(layout(content('Hello', { align: 'left', x: 100 })).left).toBe(192);
    expect(layout(content('Hello', { align: 'right', x: 900 })).left).toBe(1728 - 50);
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
      /^italic 400 40px Georgia/,
    );
  });

  it('converts #rrggbbaa to rgba', () => {
    expect(cssColor('#00000080')).toBe('rgba(0, 0, 0, 0.502)');
    expect(cssColor('#ff8800')).toBe('#ff8800');
  });
});
