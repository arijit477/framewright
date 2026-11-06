import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES, toneDb } from './media';

/**
 * Export resamples with a windowed-sinc filter. tone-9k-22k.wav is a 9 kHz
 * tone at 22.05 kHz; raised to 48 kHz by straight-line interpolation it would
 * gain an image at 13 050 Hz (22 050 − 9 000), which the filter removes.
 */
test('export resamples cleanly, without image tones', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.importFixtures(FIXTURES.highTone);
  const path = await editor.exportTo(test.info().outputDir, { resolution: '480p' });
  const tone = toneDb(path, 9000, 0.5, 1);
  const image = toneDb(path, 13_050, 0.5, 1);
  // Measured: the image 26 dB below the tone (sinc) against 5.5 dB (linear, which also dulls
  // the tone by about 5 dB).
  expect(tone - image, JSON.stringify({ tone, image })).toBeGreaterThan(20);
});
