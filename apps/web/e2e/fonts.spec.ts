import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES, frameRgb } from './media';

/**
 * Titles render in the bundled fonts, in the export worker too. The same
 * text is drawn in Display (Bebas Neue, a condensed face) and in Sans
 * (Inter): with the bundled fonts the Display title is far narrower. Without
 * them both fall back to whatever the machine has, which here is the same
 * sans-serif for both.
 */
test('exported titles use the bundled fonts', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.importFixtures(FIXTURES.overlay); // 3 s of red
  const fontField = page.getByLabel('Font');

  await editor.addTitle('HEADLINE');
  await fontField.selectOption('display');
  await editor.seekTo(3);
  await editor.addTitle('HEADLINE');
  await fontField.selectOption('sans');
  expect(await editor.tracks()).toEqual([
    'Video 3: text “HEADLINE” from 00:03:00 to 00:06:00',
    'Video 2: text “HEADLINE” from 00:00:00 to 00:03:00',
    'Video 1: red.webm from 00:00:00 to 00:03:00',
    'Audio 1: empty',
  ]);

  const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
  /** Width in px of the white text across the bottom third of the frame. */
  const textWidth = (seconds: number) => {
    const rgb = frameRgb(path, seconds, { crop: '1280:240:0:480', width: 1280, height: 240 });
    let first = Infinity;
    let last = -Infinity;
    for (let i = 0; i < rgb.length; i += 3) {
      if (Math.min(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) > 200) {
        const x = (i / 3) % 1280;
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
    return last - first;
  };
  const display = textWidth(1.5);
  const sans = textWidth(4.5);
  expect(sans).toBeGreaterThan(100); // there is a title
  expect(display / sans).toBeLessThan(0.75);
});
