import { expect, test, type Locator } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, FIXTURES, frameRgb } from './media';

/**
 * The red overlay (0-3 s, over the test pattern) is animated from the centre
 * at 0 s to the right edge at 2 s. Its left edge is then at 0 px at 0 s,
 * 320 px at 1 s and 640 px from 2 s on (holding after the last keyframe).
 */
const region = (x: number, y: number, w: number, h: number) => ({
  crop: `${w}:${h}:${x}:${y}`,
  width: 16,
  height: 8,
});
const NEAR_LEFT = region(100, 300, 150, 100); // 100-250 px
const MIDDLE_LEFT = region(400, 300, 150, 100); // 400-550 px
const RIGHT = region(900, 300, 150, 100);
const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 60 && b < 60;

test.describe('keyframes', () => {
  let editor: EditorPage;
  let keyframes: Locator;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video); // test pattern, 0-6 s
    await editor.importFixtures(FIXTURES.overlay); // red, appended at 6-9 s
    await editor.dragClip(0, 7.5, { toSeconds: 1.5, toRow: 'new-top' }); // red on top, 0-3 s
    await editor.clickClip(0, 1.5);
    keyframes = page.getByRole('group', { name: 'Keyframes' });
    await expect(keyframes).toBeVisible();

    await editor.seekTo(0);
    await keyframes.getByRole('button', { name: 'Add keyframe' }).click();
    await editor.seekTo(2);
    await editor.setSlider('Position X', 100); // keyframed at 2 s
  });

  const redTrack = async () => (await editor.tracks())[0]!;

  test('the clip moves smoothly between keyframes in the export', async () => {
    expect(await redTrack()).toContain('2 keyframes');
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    const red = (seconds: number, crop: ReturnType<typeof region>) =>
      isRed(averageRgb(frameRgb(path, seconds, crop)));
    expect(red(0.2, NEAR_LEFT)).toBe(true);
    // Halfway, the clip is halfway across.
    expect(red(1, NEAR_LEFT)).toBe(false);
    expect(red(1, MIDDLE_LEFT)).toBe(true);
    // After the last keyframe it holds at the right edge.
    expect(red(2.5, MIDDLE_LEFT)).toBe(false);
    expect(red(2.5, RIGHT)).toBe(true);
  });

  test('the inspector follows the playhead, and keyframes can be stepped through', async () => {
    await editor.seekTo(1);
    expect(await editor.sliderValue('Position X')).toBeCloseTo(75, 0);

    await keyframes.getByRole('button', { name: 'Previous keyframe' }).click();
    expect((await editor.times()).playhead).toBeCloseTo(0, 1);
    expect(await editor.sliderValue('Position X')).toBe(50);
    await expect(keyframes.getByRole('button', { name: 'Remove keyframe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await keyframes.getByRole('button', { name: 'Next keyframe' }).click();
    expect(await editor.sliderValue('Position X')).toBe(100);
  });

  test('keyframes can be removed, undone, and are saved', async () => {
    await keyframes.getByRole('button', { name: 'Remove keyframe' }).click(); // the one at 2 s
    expect(await redTrack()).toContain('1 keyframe');
    await editor.press('Control+z');
    expect(await redTrack()).toContain('2 keyframes');

    await editor.page.getByLabel('Easing to the next keyframe').selectOption('easeInOut');
    await editor.waitSaved();
    await editor.reload();
    expect(await redTrack()).toContain('2 keyframes');

    // Removing all keeps the clip as it looks at the playhead (2 s: the right edge).
    await editor.clickClip(0, 1.5);
    await editor.seekTo(2);
    await editor.page.getByRole('button', { name: 'Remove all keyframes' }).click();
    expect(await redTrack()).not.toContain('keyframe');
    expect(await editor.sliderValue('Position X')).toBe(100);
  });

  test('dragging an animated clip on the preview keyframes it at the playhead', async () => {
    await editor.seekTo(1);
    await editor.dragOnPreview([0.8, 0.5], [0.8, 0.2]); // move it up
    expect(await redTrack()).toContain('3 keyframes');
    expect(await editor.sliderValue('Position Y')).toBeLessThan(25);
    await editor.seekTo(2);
    expect(await editor.sliderValue('Position Y')).toBe(50); // the other keyframes are untouched
  });
});
