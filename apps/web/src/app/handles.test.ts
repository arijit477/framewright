import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../engine/types';
import { clipOutline, ROTATE_HANDLE_OFFSET, rotationFromDrag, scaleFromDrag } from './handles';

const close = (actual: number[], expected: number[]) =>
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));

describe('clipOutline', () => {
  it('fills a matching preview; the rotate handle moves inside rather than off it', () => {
    const o = clipOutline(1920, 1080, 640, 360, IDENTITY_TRANSFORM);
    close(o.centre, [320, 180]);
    close(o.corners.flat(), [0, 0, 640, 0, 640, 360, 0, 360]);
    close(o.rotateHandle, [320, ROTATE_HANDLE_OFFSET]);
  });

  it('puts the rotate handle above the top edge when there is room', () => {
    const o = clipOutline(1920, 1080, 640, 360, { ...IDENTITY_TRANSFORM, scalePercent: 50 });
    close(o.rotateHandle, [320, 90 - ROTATE_HANDLE_OFFSET]);
  });

  it('follows position, scale and rotation', () => {
    // Half size, centred at 75% across, turned a quarter clockwise.
    const o = clipOutline(1920, 1080, 640, 360, {
      ...IDENTITY_TRANSFORM,
      x: 750,
      scalePercent: 50,
      rotationDeg: 90,
    });
    close(o.centre, [480, 180]);
    // 320×180, turned: the top left corner is now at the top right.
    close(o.corners[0], [480 + 90, 180 - 160]);
    // "Up" now points right.
    close(o.rotateHandle, [480 + 90 + ROTATE_HANDLE_OFFSET, 180]);
  });

  it('letterboxes a source of another shape, like the compositor', () => {
    const o = clipOutline(1080, 1080, 640, 360, IDENTITY_TRANSFORM); // square in 16:9
    close(o.corners.flat(), [140, 0, 500, 0, 500, 360, 140, 360]);
  });
});

describe('scaleFromDrag', () => {
  const centre: [number, number] = [100, 100];

  it('scales with the distance from the centre', () => {
    expect(scaleFromDrag(centre, [200, 100], [300, 100], 100)).toBe(200);
    expect(scaleFromDrag(centre, [200, 200], [150, 150], 80)).toBe(40);
  });

  it('stays within the limits', () => {
    expect(scaleFromDrag(centre, [101.5, 100], [10_000, 100], 100)).toBe(1000);
    expect(scaleFromDrag(centre, [200, 100], [100, 100], 100)).toBe(1);
    expect(scaleFromDrag(centre, [100.5, 100], [300, 100], 70)).toBe(70); // grabbed at the centre
  });
});

describe('rotationFromDrag', () => {
  const centre: [number, number] = [0, 0];

  it('turns as far as the pointer does, clockwise positive', () => {
    expect(rotationFromDrag(centre, [0, -10], [10, 0], 0)).toBe(90);
    expect(rotationFromDrag(centre, [0, -10], [-10, 0], 10)).toBe(-80);
  });

  it('wraps into −180…180', () => {
    expect(rotationFromDrag(centre, [0, -10], [0, 10], 0)).toBe(180);
    expect(rotationFromDrag(centre, [0, -10], [10, 0], 150)).toBe(-120);
  });

  it('snaps to 15° when asked', () => {
    expect(rotationFromDrag(centre, [0, -10], [10, -9], 0, true)).toBe(45); // ≈ 48°
    expect(rotationFromDrag(centre, [0, -10], [10, -9], 0)).toBe(48);
    expect(rotationFromDrag(centre, [0, -10], [1, -10], 0, true)).toBe(0); // no −0
  });
});
