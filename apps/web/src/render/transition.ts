import type { LayerTransition } from '../engine/types';

/** What a transition does to one layer at a moment in time. */
export interface TransitionEffect {
  /** Multiplies the layer's opacity. */
  opacity: number;
  /** Horizontal shift, as a fraction of the canvas width. */
  offsetX: number;
  /** Visible horizontal band, as fractions of the canvas width (from, to). */
  reveal: [number, number];
}

export const NO_EFFECT: TransitionEffect = { opacity: 1, offsetX: 0, reveal: [0, 1] };

/** Ease in and out, so motion starts and ends gently. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The effect on a layer that takes part in a transition. The engine supplies
 * which side it is and how far through (0–1000); this turns that into
 * opacity, offset and reveal, used identically by both compositors.
 */
export function transitionEffect(transition: LayerTransition | undefined): TransitionEffect {
  if (!transition) return NO_EFFECT;
  const p = Math.min(1, Math.max(0, transition.progress / 1000));
  const { outgoing } = transition;
  switch (transition.kind) {
    case 'crossfade':
      // The incoming clip fades in over the outgoing one, which stays put.
      return outgoing ? NO_EFFECT : { ...NO_EFFECT, opacity: p };
    case 'dip':
      // Out over the first half, in over the second.
      return {
        ...NO_EFFECT,
        opacity: outgoing ? Math.max(0, 1 - 2 * p) : Math.max(0, 2 * p - 1),
      };
    case 'slide': {
      // The incoming clip pushes the outgoing one off to the left.
      const s = smooth(p);
      return { ...NO_EFFECT, offsetX: outgoing ? -s : 1 - s };
    }
    case 'wipe':
      // The incoming clip is revealed from the left edge.
      return outgoing ? NO_EFFECT : { ...NO_EFFECT, reveal: [0, p] };
  }
}
