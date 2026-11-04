import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { adjustRgb, colorParams } from '../src/render/color';
import { applyLutRgb, parseCube } from '../src/render/lut';
import { EditorPage } from './editor-page';
import { averageRgb, fixture, FIXTURES, frameRgb } from './media';

/**
 * swap.cube swaps red and blue and lifts green. The test pattern's six colour
 * bars are exported before and after, and must match the reference maths.
 */
const BAR_REGIONS = Array.from({ length: 6 }, (_, i) => ({
  crop: `120:120:${i * 213 + 46}:40`,
  width: 16,
  height: 8,
}));
/** Encoding noise and rounding (the colour filters measured within ~1). */
const TOLERANCE = 6;
type Rgb = [number, number, number];
const lut = parseCube(readFileSync(fixture(FIXTURES.lut), 'utf8')).lut;

test.describe('LUTs', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.clickClip(0, 1.5);
  });

  const exportBars = async (): Promise<Rgb[]> => {
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    return BAR_REGIONS.map((crop) => averageRgb(frameRgb(path, 1, crop)));
  };
  const loadLut = (path = fixture(FIXTURES.lut)) =>
    editor.page.getByLabel('LUT file').setInputFiles(path);
  const expectBars = (actual: Rgb[], expected: Rgb[]) =>
    actual.forEach((rgb, bar) =>
      rgb.forEach((value, channel) =>
        expect(
          Math.abs(value - expected[bar]![channel]!),
          `bar ${bar}: got ${rgb}, expected ${expected[bar]!.map(Math.round)}`,
        ).toBeLessThan(TOLERANCE),
      ),
    );
  const through = (before: Rgb[], f: (rgb: Rgb) => Rgb) =>
    before.map((rgb) => f(rgb.map((v) => v / 255) as Rgb).map((v) => v * 255) as Rgb);

  test('a loaded LUT grades the export, at full and half intensity', async () => {
    const before = await exportBars();
    await loadLut();
    await expect(editor.page.getByLabel('LUT', { exact: true })).toHaveValue(/.+/);
    await expect(
      editor.page.getByLabel('LUT', { exact: true }).locator('option:checked'),
    ).toHaveText('Swap');
    expectBars(
      await exportBars(),
      through(before, (rgb) => applyLutRgb(rgb, lut, 1)),
    );

    await editor.setSlider('LUT intensity', 50);
    expectBars(
      await exportBars(),
      through(before, (rgb) => applyLutRgb(rgb, lut, 0.5)),
    );
  });

  test('the colour sliders apply after the LUT', async () => {
    const before = await exportBars();
    await loadLut();
    await editor.setSlider('Saturation', -60);
    const params = colorParams({ brightness: 0, contrast: 0, saturation: -60 });
    expectBars(
      await exportBars(),
      through(before, (rgb) => adjustRgb(applyLutRgb(rgb, lut, 1), params)),
    );
  });

  test('LUTs are saved with the project and can be removed from a clip', async () => {
    await loadLut();
    await editor.waitSaved();
    await editor.reload();
    await editor.clickClip(0, 1.5);
    const select = editor.page.getByLabel('LUT', { exact: true });
    await expect(select.locator('option:checked')).toHaveText('Swap');
    await select.selectOption('');
    await expect(editor.page.getByRole('slider', { name: 'LUT intensity' })).toHaveCount(0);
    await editor.press('Control+z');
    await expect(select.locator('option:checked')).toHaveText('Swap');
  });

  test('a file that is not a 3D LUT is refused with a reason', async () => {
    await editor.page.getByLabel('LUT file').setInputFiles({
      name: 'curve.cube',
      mimeType: 'text/plain',
      buffer: Buffer.from('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n'),
    });
    await expect(editor.page.getByText(/Couldn’t use curve\.cube: .*1D LUT/)).toBeVisible();
    await expect(editor.page.getByLabel('LUT', { exact: true })).toHaveValue('');
  });
});
