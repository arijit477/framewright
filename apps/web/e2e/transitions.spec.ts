import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, FIXTURES, frameRgb } from './media';

/**
 * The test pattern (0-6 s) cuts to solid red (6-9 s). Transitions are checked
 * on exported 1280×720 files just before, at and after the cut.
 */
const region = (x: number, y: number, w: number, h: number) => ({
  crop: `${w}:${h}:${x}:${y}`,
  width: 16,
  height: 8,
});
const CENTRE = region(560, 300, 160, 120);
const LEFT = region(80, 300, 200, 120);
const RIGHT = region(1000, 300, 200, 120);
/** The pattern's blue bar (measured: x 640-853, ≈ 0,0,255). */
const BLUE_BAR = region(686, 40, 120, 120);
type Rgb = [number, number, number];
const isRed = ([r, g, b]: Rgb) => r > 200 && g < 60 && b < 60;

test.describe('transitions', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.importFixtures(FIXTURES.overlay); // appended: red at 6-9 s
    await editor.clickClip(0, 7.5); // select the red clip
  });

  const exported = async () => {
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    return (seconds: number, crop = CENTRE): Rgb => averageRgb(frameRgb(path, seconds, crop));
  };

  test('crossfade blends the clips across the cut', async () => {
    await editor.setTransition('crossfade', 1000);
    const at = await exported();
    expect(isRed(at(5.3))).toBe(false); // before the 5.5-6.5 s window: just the pattern
    const [r, g, b] = at(6.0, BLUE_BAR); // midpoint: 50% red over the (held) blue bar
    expect(r).toBeGreaterThan(90);
    expect(r).toBeLessThan(170);
    expect(b).toBeGreaterThan(90);
    expect(b).toBeLessThan(170);
    expect(g).toBeLessThan(40);
    expect(isRed(at(6.7))).toBe(true); // after the window: just red
  });

  test('wipe reveals the next clip from the left', async () => {
    await editor.setTransition('wipe', 1000);
    const at = await exported();
    expect(isRed(at(6.0, LEFT))).toBe(true);
    expect(isRed(at(6.0, RIGHT))).toBe(false);
  });

  test('dip fades through black', async () => {
    await editor.setTransition('dip', 1000);
    const at = await exported();
    const [r, g, b] = at(6.0);
    expect(Math.max(r, g, b)).toBeLessThan(30);
  });

  test('slide pushes the old clip out to the left', async () => {
    await editor.setTransition('slide', 1000);
    const at = await exported();
    // Halfway: red covers the right half, the pattern is shifted into the left half.
    expect(isRed(at(6.0, RIGHT))).toBe(true);
    expect(isRed(at(6.0, LEFT))).toBe(false);
  });

  test('a transition needs touching clips, undoes, and is saved', async () => {
    await editor.setTransition('crossfade', 500);
    const videoTrack = async () => (await editor.tracks()).find((t) => t.startsWith('Video'))!;
    expect(await videoTrack()).toContain('crossfade into red.webm');

    // Move the red clip away from the cut: the transition no longer applies.
    await editor.dragClip(0, 7.5, { toSeconds: 8.5, toRow: 0 });
    expect(await videoTrack()).not.toContain('crossfade into');
    await expect(editor.page.getByText('Place this clip right after another')).toBeVisible();

    await editor.press('Control+z');
    expect(await videoTrack()).toContain('crossfade into red.webm');

    await editor.waitSaved();
    await editor.reload();
    expect(await videoTrack()).toContain('crossfade into red.webm');
  });
});
