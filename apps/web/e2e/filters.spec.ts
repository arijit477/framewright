import { expect, test } from '@playwright/test';
import { adjustRgb, colorParams } from '../src/render/color';
import { EditorPage } from './editor-page';
import { averageRgb, FIXTURES, frameRgb } from './media';

/**
 * Colour adjustments are checked on exported 1280×720 files. The test
 * pattern's six colour bars (213 px wide) are sampled before and after, and
 * the adjusted colours must match the reference maths every renderer uses.
 */
const BAR_REGIONS = Array.from({ length: 6 }, (_, i) => ({
  crop: `120:120:${i * 213 + 46}:40`,
  width: 16,
  height: 8,
}));
/** Encoding noise and rounding: measured within ~1 of the reference. */
const TOLERANCE = 6;
type Rgb = [number, number, number];

test.describe('filters', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.clickClip(0, 1.5);
    await expect(page.getByRole('region', { name: 'Color' })).toBeVisible();
  });

  const exportBars = async (): Promise<Rgb[]> => {
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    return BAR_REGIONS.map((crop) => averageRgb(frameRgb(path, 1, crop)));
  };

  test('adjusted exports match the reference colour maths', async () => {
    const before = await exportBars();
    const color = { brightness: 30, contrast: 40, saturation: -50 };
    await editor.setSlider('Brightness', color.brightness);
    await editor.setSlider('Contrast', color.contrast);
    await editor.setSlider('Saturation', color.saturation);
    const after = await exportBars();

    const params = colorParams(color);
    before.forEach((rgb, bar) => {
      const expected = adjustRgb(rgb.map((v) => v / 255) as Rgb, params).map((v) => v * 255);
      after[bar]!.forEach((value, channel) => {
        expect(
          Math.abs(value - expected[channel]!),
          `bar ${bar}, channel ${channel}: got ${after[bar]}, expected ${expected}`,
        ).toBeLessThan(TOLERANCE);
      });
    });
    // And the change is real: the bars got less colourful.
    const spread = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);
    expect(spread(after[0]!)).toBeLessThan(spread(before[0]!) - 60);
  });

  test('a look applies in one click, undoes, and is saved', async () => {
    const look = editor.page.getByRole('button', { name: 'Black & white' });
    await look.click();
    await expect(look).toHaveAttribute('aria-pressed', 'true');
    expect(await editor.sliderValue('Saturation')).toBe(-100);

    const bars = await exportBars();
    for (const [r, g, b] of bars) {
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(TOLERANCE); // grey
    }

    await editor.press('Control+z');
    expect(await editor.sliderValue('Saturation')).toBe(0);
    await editor.press('Control+Shift+z');
    await editor.waitSaved();
    await editor.reload();
    await editor.clickClip(0, 1.5);
    expect(await editor.sliderValue('Saturation')).toBe(-100);

    await editor.page.getByRole('button', { name: 'Reset color' }).click();
    expect(await editor.sliderValue('Saturation')).toBe(0);
  });
});
