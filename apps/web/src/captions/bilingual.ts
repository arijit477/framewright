/**
 * Bilingual captions: the original and its translation on screen together,
 * the original above and the translation (a little smaller) below. Both anchor
 * to the line between them (the original by its bottom edge, the translation
 * by its top), so however many lines either wraps to, at any frame size, they
 * grow apart and never overlap.
 */
import type { TextStyle } from '../engine/types';
import { BOX_PADDING_Y, REFERENCE_HEIGHT } from '../render/text';

export const BILINGUAL = {
  /** The translation's size relative to the original. */
  translationScale: 0.8,
  /** Where the line between them may go, in thousandths of the frame height. */
  minSeam: 150,
  maxSeam: 830,
  /** Space between the two blocks, in addition to their boxes' padding, in pixels at 1080p. */
  spacingPx: 6,
} as const;

/** The original's and the translation's styles, from the original's. */
export function bilingualStyles(original: TextStyle): {
  original: TextStyle;
  translation: TextStyle;
} {
  const translationSize = Math.max(1, Math.round(original.size * BILINGUAL.translationScale));
  // Captions sit where the original was, held clear of the frame's bottom edge.
  const seam = Math.min(BILINGUAL.maxSeam, Math.max(BILINGUAL.minSeam, original.y));
  // Each side leaves room for its own box padding (and half the spacing).
  const half = (size: number) =>
    Math.ceil(((size * BOX_PADDING_Y + BILINGUAL.spacingPx / 2) * 1000) / REFERENCE_HEIGHT);
  const { highlight: _, ...plain } = original;
  return {
    original: { ...original, anchorY: 'bottom', y: seam - half(original.size) },
    translation: {
      ...plain,
      size: translationSize,
      anchorY: 'top',
      y: seam + half(translationSize),
    },
  };
}
