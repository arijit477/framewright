import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { averageRgb, FIXTURES, frameRgb } from './media';

/**
 * Smart reframing. face-pan.webm is 16:9: a portrait slides across a green
 * background, its face from x ≈ 200 px (of 1280) at the start to ≈ 1080 px at
 * the end. In a 9:16 frame, filled, only the middle ~32% of the picture shows:
 * a static fill shows green background at the start; following the face keeps
 * it in the middle throughout.
 */
test.describe('smart reframing', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page, context }) => {
    await cacheHuggingFace(context); // the face detector comes from Hugging Face
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.facePan);
    await page
      .getByRole('group', { name: 'Frame shape' })
      .getByRole('button', { name: '9:16' })
      .click();
    await editor.clickClip(0, 1);
  });

  /** Is the middle of the exported 720×1280 frame green background (no face there)? */
  const middleIsBackground = (path: string, seconds: number) => {
    const [r, g, b] = averageRgb(
      frameRgb(path, seconds, { crop: '160:240:280:520', width: 8, height: 8 }),
    );
    return g > r + 40 && g > b + 40;
  };

  test('follows a face across the picture with keyframes', async () => {
    await editor.page.getByRole('button', { name: 'Fill and follow faces' }).click();
    await expect(editor.page.getByText(/^Following faces: \d+ keyframes\.$/)).toBeVisible({
      timeout: 60_000,
    });
    const track = (await editor.tracks())[0]!;
    const count = Number(/(\d+) keyframes/.exec(track)?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThan(20); // a calm path, not a jittery one

    const path = await editor.exportTo(test.info().outputPath('follow'), { resolution: '720p' });
    for (const s of [0.5, 3, 5.5]) {
      expect(middleIsBackground(path, s), `face in the middle at ${s} s`).toBe(false);
    }

    // One undo takes the animation away again.
    await editor.press('Control+z');
    expect((await editor.tracks())[0]).not.toMatch(/keyframes/);
  });

  test('without following, a filled frame loses the face at the start', async () => {
    // The control experiment for the test above: centred, the face isn't in view at first.
    await editor.page.getByRole('button', { name: 'Fill frame' }).click();
    const path = await editor.exportTo(test.info().outputPath('static'), { resolution: '720p' });
    expect(middleIsBackground(path, 0.5)).toBe(true);
  });
});
