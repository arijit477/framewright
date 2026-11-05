import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { averageRgb, FIXTURES, frameRgb } from './media';

/**
 * Background removal. red.webm (3 s of red) sits on the lower track; above it,
 * talking-head.webm: a portrait filling the frame's height on green (x 352–928
 * of 1280×720 at the start, the face around the middle). With the background
 * removed, the green shows the red track below, and the person stays.
 */
test.describe('remove background', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page, context }) => {
    await cacheHuggingFace(context); // the segmentation model comes from Hugging Face
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.overlay); // red, 0-3 s
    await editor.importFixtures(FIXTURES.talkingHead); // appended at 3 s
    await editor.dragClip(0, 4.5, { toSeconds: 1.5, toRow: 'new-top' }); // portrait on top, 0-4 s
    await editor.clickClip(0, 1);
  });

  type Rgb = [number, number, number];
  const isGreen = ([r, g, b]: Rgb) => g > r + 40 && g > b + 40;
  const isRed = ([r, g, b]: Rgb) => r > 150 && g < 80 && b < 80;
  /** Background (right of the person) and the face (cheek), at 1 s of a 720p export. */
  const regions = (path: string) => ({
    background: averageRgb(frameRgb(path, 1, { crop: '250:300:1000:100', width: 8, height: 8 })),
    face: averageRgb(frameRgb(path, 1, { crop: '80:60:580:330', width: 4, height: 4 })),
  });

  test('cuts the person out, showing the track below, in export and preview', async () => {
    const before = regions(
      await editor.exportTo(test.info().outputPath('before'), { resolution: '720p' }),
    );
    expect(isGreen(before.background)).toBe(true);

    await editor.page.getByLabel('Remove background').check();
    const after = regions(
      await editor.exportTo(test.info().outputPath('after'), { resolution: '720p' }),
    );
    expect(isRed(after.background), JSON.stringify(after.background)).toBe(true);
    // The face is still there: neither the green background nor the red track below.
    expect(isGreen(after.face) || isRed(after.face), JSON.stringify(after.face)).toBe(false);

    // The preview shows the same.
    await editor.seekTo(1);
    const canvas = editor.page.locator('.preview-frame canvas');
    const box = (await canvas.boundingBox())!;
    const shot = test.info().outputPath('preview.png');
    await expect
      .poll(async () => {
        await canvas.screenshot({ path: shot });
        const w = Math.round(box.width);
        const h = Math.round(box.height);
        const crop = `${Math.round(w * 0.23)}:${Math.round(h * 0.28)}:${Math.round(w * 0.7)}:${Math.round(h * 0.14)}`;
        return isRed(averageRgb(frameRgb(shot, 0, { crop, width: 4, height: 4 })));
      })
      .toBe(true);
  });

  test('is saved with the clip and undoable', async () => {
    await editor.page.getByLabel('Remove background').check();
    // The toolbar buttons: shortcuts are left to a focused checkbox.
    await editor.page.getByRole('button', { name: 'Undo' }).click();
    await expect(editor.page.getByLabel('Remove background')).not.toBeChecked();
    await editor.page.getByRole('button', { name: 'Redo' }).click();
    await expect(editor.page.getByLabel('Remove background')).toBeChecked();
    await editor.waitSaved();
    await editor.reload();
    await editor.clickClip(0, 1);
    await expect(editor.page.getByLabel('Remove background')).toBeChecked();
  });
});
