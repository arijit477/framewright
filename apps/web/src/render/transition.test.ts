import { describe, expect, it } from 'vitest';
import type { LayerTransition, TransitionKind } from '../engine/types';
import { NO_EFFECT, transitionEffect } from './transition';

const at = (kind: TransitionKind, outgoing: boolean, progress: number): LayerTransition => ({
  kind,
  outgoing,
  progress,
});

describe('transitionEffect', () => {
  it('leaves layers outside transitions alone', () => {
    expect(transitionEffect(undefined)).toEqual(NO_EFFECT);
  });

  it('crossfade: the incoming clip fades in over the outgoing one', () => {
    expect(transitionEffect(at('crossfade', true, 500))).toEqual(NO_EFFECT);
    expect(transitionEffect(at('crossfade', false, 0)).opacity).toBe(0);
    expect(transitionEffect(at('crossfade', false, 500)).opacity).toBe(0.5);
    expect(transitionEffect(at('crossfade', false, 1000)).opacity).toBe(1);
  });

  it('dip: fades out, then in, with nothing visible at the midpoint', () => {
    expect(transitionEffect(at('dip', true, 250)).opacity).toBe(0.5);
    expect(transitionEffect(at('dip', true, 500)).opacity).toBe(0);
    expect(transitionEffect(at('dip', false, 500)).opacity).toBe(0);
    expect(transitionEffect(at('dip', false, 750)).opacity).toBe(0.5);
  });

  it('slide: both clips move left together, eased', () => {
    const out = transitionEffect(at('slide', true, 500));
    const inc = transitionEffect(at('slide', false, 500));
    expect(out.offsetX).toBe(-0.5);
    expect(inc.offsetX).toBe(0.5);
    expect(inc.offsetX - out.offsetX).toBe(1); // edge to edge, no gap or overlap
    expect(transitionEffect(at('slide', false, 0)).offsetX).toBe(1); // starts off-screen right
    expect(transitionEffect(at('slide', false, 100)).offsetX).toBeGreaterThan(0.9); // eased start
  });

  it('wipe: reveals the incoming clip from the left', () => {
    expect(transitionEffect(at('wipe', false, 300)).reveal).toEqual([0, 0.3]);
    expect(transitionEffect(at('wipe', true, 300))).toEqual(NO_EFFECT);
  });

  it('clamps progress', () => {
    expect(transitionEffect(at('crossfade', false, 1200)).opacity).toBe(1);
  });
});
