import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

const FILMSTRIP_MIN_COLOURS = 6; // as in thumbnails.spec.ts

/**
 * Filmstrips are cached with the project: reopening it shows them straight
 * away instead of decoding the videos again. Counted by watching what the page
 * asks the thumbnail worker to generate.
 */
test('reopening a project shows cached filmstrips without decoding again', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { thumbnailRequests: number };
    w.thumbnailRequests = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: never[]) {
      if ((message as { type?: string })?.type === 'generate') w.thumbnailRequests++;
      return post.call(this, message, ...rest);
    } as typeof post;
  });
  const requests = () =>
    page.evaluate(() => (window as unknown as { thumbnailRequests: number }).thumbnailRequests);

  const editor = new EditorPage(page);
  await editor.goto();
  await editor.importFixtures(FIXTURES.video);
  await expect
    .poll(() => editor.clipColors(0, 0.2, 5.8), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(FILMSTRIP_MIN_COLOURS);
  expect(await requests()).toBe(1);
  // The finished strip is saved with the project (one image and its description).
  const projectId = (await editor.storedFiles('projects')).find((n) => /^[0-9a-f-]{36}$/.test(n))!;
  await expect
    .poll(() => editor.storedFiles(`projects/${projectId}/thumbnails`))
    .toEqual(
      expect.arrayContaining([expect.stringMatching(/\.webp$/), expect.stringMatching(/\.json$/)]),
    );

  await editor.waitSaved();
  await editor.reload();
  await expect
    .poll(() => editor.clipColors(0, 0.2, 5.8), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(FILMSTRIP_MIN_COLOURS);
  expect(await requests()).toBe(0); // from the cache: nothing decoded
});
