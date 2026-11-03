import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/** A plain clip draws one or two colours across a row; a filmstrip draws many. */
const FILMSTRIP_MIN_COLOURS = 6;
const PLAIN_MAX_COLOURS = 3;

test.describe('timeline thumbnails', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
  });

  test('video clips show a filmstrip; audio clips do not', async () => {
    await expect
      .poll(() => editor.clipColors(0, 0.2, 5.8), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(FILMSTRIP_MIN_COLOURS);
    expect(await editor.clipColors(1, 0.5, 3.5)).toBeLessThanOrEqual(PLAIN_MAX_COLOURS + 2); // waveform band
  });

  test('the filmstrip follows the clip when it is moved', async () => {
    await expect
      .poll(() => editor.clipColors(0, 0.2, 5.8), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(FILMSTRIP_MIN_COLOURS);
    // Drag the video clip 3 s to the right.
    const box = (await editor.timeline.boundingBox())!;
    const y = box.y + 28 + 6 + 28;
    await editor.page.mouse.move(box.x + 12 + 60 * 2, y);
    await editor.page.mouse.down();
    await editor.page.mouse.move(box.x + 12 + 60 * 5, y, { steps: 5 });
    await editor.page.mouse.up();
    expect(await editor.clipColors(0, 0.2, 2.8)).toBeLessThanOrEqual(PLAIN_MAX_COLOURS); // empty track now
    expect(await editor.clipColors(0, 3.2, 8.8)).toBeGreaterThanOrEqual(FILMSTRIP_MIN_COLOURS);
  });

  test('the filmstrip is rebuilt after a reload', async () => {
    await editor.waitSaved();
    await editor.reload();
    await expect
      .poll(() => editor.clipColors(0, 0.2, 5.8), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(FILMSTRIP_MIN_COLOURS);
  });
});
