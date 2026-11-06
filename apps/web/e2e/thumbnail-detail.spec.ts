import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, FIXTURES, frameRgb } from './media';

/**
 * Zoomed far in, the filmstrip gets finer thumbnails. hue-cycle.webm is one
 * colour whose hue turns a full circle each second, so pictures from moments
 * 0.1 s apart are clearly different colours. At 800 px/s a 92 px tile covers
 * about 0.12 s, while the base strip has one picture a second: with the base
 * strip alone, the first eight tiles would all show the same colour.
 */
test('zoomed in, neighbouring filmstrip tiles show different moments', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.importFixtures(FIXTURES.hueCycle);
  await page.getByRole('slider', { name: 'Zoom' }).press('End'); // the maximum: 800 px/s

  const TILE = (52 * 128) / 72; // clip height × thumbnail aspect (16:9)
  const LEFT = 12; // TRACK_PADDING_X: the clip starts at 0 s
  /** How many of the first `n` neighbouring tile pairs show different colours. */
  const differingPairs = async (n: number) => {
    const shot = test.info().outputPath('timeline.png');
    await editor.timeline.screenshot({ path: shot });
    // The middle of each tile, clear of its edges, the clip name and the shading.
    const colours = Array.from({ length: n + 1 }, (_, i) =>
      averageRgb(
        frameRgb(shot, 0, {
          crop: `40:8:${Math.round(LEFT + i * TILE + TILE / 2 - 20)}:60`,
          width: 4,
          height: 2,
        }),
      ),
    );
    let differing = 0;
    for (let i = 0; i < n; i++) {
      const a = colours[i]!;
      const b = colours[i + 1]!;
      if (Math.max(...a.map((v, c) => Math.abs(v - b[c]!))) > 15) differing++;
    }
    return differing;
  };
  // With the base strip alone, at most one of these pairs would differ (at 1 s).
  await expect.poll(() => differingPairs(8), { timeout: 20_000 }).toBeGreaterThanOrEqual(7);
});
