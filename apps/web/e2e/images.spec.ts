import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, FIXTURES, frameRgb, probe } from './media';

/**
 * Still images as clips: blue-square.png (600×600 blue) and yellow.jpg
 * (1280×720 yellow). An image lasts 5 s when added and can be stretched to any
 * length; it's drawn like video (fitted to the frame, then transformed).
 */
test.describe('image clips', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
  });

  type Rgb = [number, number, number];
  const isBlue = ([r, g, b]: Rgb) => b > 150 && r < 60 && g < 60;
  const isYellow = ([r, g, b]: Rgb) => r > 180 && g > 180 && b < 80;
  const isBlack = ([r, g, b]: Rgb) => r + g + b < 30;
  const at = (path: string, seconds: number, crop: string) =>
    averageRgb(frameRgb(path, seconds, { crop, width: 4, height: 4 }));

  test('an image lasts 5 s, can be stretched, and exports like a picture', async () => {
    await editor.importFixtures(FIXTURES.squarePng);
    expect((await editor.tracks())[0]).toBe('Video 1: blue-square.png from 00:00:00 to 00:05:00');

    // Stretch it from 5 s to 12 s by its end edge: a still has no length of its own.
    await editor.dragClip(0, 4.98, { toSeconds: 12, toRow: 0 });
    expect((await editor.tracks())[0]).toBe('Video 1: blue-square.png from 00:00:00 to 00:12:00');

    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p' });
    expect(Number(probe(path).format.duration)).toBeCloseTo(12, 0);
    for (const s of [0.5, 11.5]) {
      // Square in a 16:9 frame: the picture in the middle, black bars at the sides.
      expect(isBlue(at(path, s, '200:200:540:260')), `${s} s middle`).toBe(true);
      expect(isBlack(at(path, s, '100:200:20:260')), `${s} s side`).toBe(true);
    }
  });

  test('images follow each other, take transforms, and come back after a reload', async () => {
    await editor.importFixtures(FIXTURES.squarePng, FIXTURES.widePhoto);
    expect((await editor.tracks())[0]).toBe(
      'Video 1: blue-square.png from 00:00:00 to 00:05:00; yellow.jpg from 00:05:00 to 00:10:00',
    );
    // Fill the frame with the square: the bars go.
    await editor.clickClip(0, 1);
    await editor.page.getByRole('button', { name: 'Fill frame' }).click();
    // Following faces is for video; an image just fills.
    await expect(editor.page.getByRole('button', { name: 'Fill and follow faces' })).toHaveCount(0);

    await editor.waitSaved();
    await editor.reload();
    expect((await editor.tracks())[0]).toContain('yellow.jpg from 00:05:00 to 00:10:00');
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p' });
    expect(isBlue(at(path, 1, '100:200:20:260'))).toBe(true); // filled to the edge
    expect(isYellow(at(path, 7, '200:200:540:260'))).toBe(true);
  });

  test('importing explains which files work', async () => {
    await editor.page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      });
    await expect(editor.page.getByText(/video, audio or image file/)).toBeVisible();
  });
});
