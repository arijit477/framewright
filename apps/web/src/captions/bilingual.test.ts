import { describe, expect, it } from 'vitest';
import type { TextContent, TextStyle } from '../engine/types';
import { layoutText } from '../render/text';
import { BILINGUAL, bilingualStyles } from './bilingual';

const base: TextStyle = {
  font: 'sans',
  size: 52,
  color: '#ffffff',
  background: '#000000b3',
  bold: true,
  italic: false,
  align: 'center',
  x: 500,
  y: 880,
  animationIn: 'none',
  animationOut: 'none',
  animationMs: 400,
  highlight: '#facc15',
};

describe('bilingualStyles', () => {
  it('puts the original above the line and a smaller translation below it', () => {
    const { original, translation } = bilingualStyles(base);
    expect(original.anchorY).toBe('bottom');
    expect(translation.anchorY).toBe('top');
    expect(original.y).toBeLessThan(BILINGUAL.maxSeam);
    expect(translation.y).toBeGreaterThan(BILINGUAL.maxSeam);
    expect(translation.size).toBe(Math.round(52 * BILINGUAL.translationScale));
    expect(original.highlight).toBe('#facc15'); // the original keeps its word highlight
    expect(translation.highlight).toBeUndefined(); // the translation has no word timings
  });

  it('keeps captions moved higher up where they were', () => {
    const { original, translation } = bilingualStyles({ ...base, y: 400 });
    expect(original.y).toBeLessThan(400);
    expect(translation.y).toBeGreaterThan(400);
  });

  it('never overlaps, boxes included, however many lines and at any frame size', () => {
    const { original, translation } = bilingualStyles(base);
    const measure = (font: string) => {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
      return (text: string) => text.length * px * 0.55;
    };
    const long = 'many words here '.repeat(12);
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920], // vertical video: more wrapping
      [1280, 720],
    ] as const) {
      for (const text of ['Hi', long]) {
        const box = (style: TextStyle) => {
          const l = layoutText({ text, style } as TextContent, w, h, measure);
          const pad = l.fontPx * 0.15;
          return { top: l.top - pad, bottom: l.top + l.height + pad };
        };
        expect(box(original).bottom, `${w}x${h}`).toBeLessThanOrEqual(box(translation).top);
      }
    }
  });
});
