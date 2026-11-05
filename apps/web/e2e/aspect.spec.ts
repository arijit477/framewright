import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, FIXTURES, frameRgb, probe } from './media';

/**
 * Frame shapes. tone.webm is a 16:9 test pattern: in a 9:16 frame it's fitted
 * as a band across the middle (black above and below) until "Fill frame"
 * scales it to cover the frame.
 */
test.describe('frame shape', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
  });

  const shapes = () => editor.page.getByRole('group', { name: 'Frame shape' });
  const choose = (label: string) => shapes().getByRole('button', { name: label }).click();
  const previewRatio = async () => {
    const box = (await editor.page.locator('.preview-frame').boundingBox())!;
    return box.width / box.height;
  };
  /** Average colour of the top tenth of an exported frame (black where there's no video). */
  const topBand = (path: string, width: number, height: number, seconds = 1) =>
    averageRgb(
      frameRgb(path, seconds, {
        crop: `${width}:${Math.round(height / 10)}:0:0`,
        width: 16,
        height: 4,
      }),
    );
  const isBlack = ([r, g, b]: [number, number, number]) => r + g + b < 15;

  test('a vertical project previews and exports at 9:16', async () => {
    expect(await previewRatio()).toBeCloseTo(16 / 9, 1);
    await choose('9:16');
    await expect(shapes().getByRole('button', { name: '9:16' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(previewRatio).toBeCloseTo(9 / 16, 1);
    // The preview draws at the new shape (fitted, black above), not stretched to it.
    await editor.seekTo(1);
    const shot = test.info().outputPath('preview.png');
    await editor.page.locator('.preview-frame canvas').screenshot({ path: shot });
    const box = (await editor.page.locator('.preview-frame canvas').boundingBox())!;
    await expect
      .poll(async () => {
        await editor.page.locator('.preview-frame canvas').screenshot({ path: shot });
        return isBlack(topBand(shot, Math.floor(box.width), Math.floor(box.height), 0));
      })
      .toBe(true);

    await editor.openExport();
    await editor.chooseExportSettings({ resolution: '720p' });
    await expect(editor.page.locator('dialog[open]').getByText(/^720×1280 ·/)).toBeVisible();
    await editor.page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p' });
    const video = probe(path).streams.find((s) => s.codec_type === 'video')!;
    expect([video.width, video.height]).toEqual([720, 1280]);
    // The widescreen video is fitted: a band across the middle, black above it.
    expect(isBlack(topBand(path, 720, 1280))).toBe(true);
  });

  test('"Fill frame" scales a clip to cover the new shape', async () => {
    await choose('9:16');
    await editor.clickClip(0, 1);
    await editor.page.getByRole('button', { name: 'Fill frame' }).click();
    expect(await editor.sliderValue('Scale')).toBe(317);
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p' });
    expect(isBlack(topBand(path, 720, 1280))).toBe(false); // the picture reaches the top
  });

  test('the shape is one undo step, and is saved with the project', async () => {
    await choose('1:1');
    await expect.poll(previewRatio).toBeCloseTo(1, 1);
    await editor.press('Control+z');
    await expect.poll(previewRatio).toBeCloseTo(16 / 9, 1);
    await editor.press('Control+Shift+z');
    await expect.poll(previewRatio).toBeCloseTo(1, 1);

    await editor.waitSaved();
    await editor.reload();
    await expect(shapes().getByRole('button', { name: '1:1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect.poll(previewRatio).toBeCloseTo(1, 1);
  });
});
