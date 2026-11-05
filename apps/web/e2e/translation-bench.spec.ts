import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { fixture, FIXTURES } from './media';

/**
 * How long translating a realistic caption track takes (opt-in: `BENCH=1`).
 * jfk.wav repeated 30 times (5.5 minutes, about 60 captions) is captioned,
 * then translated into Spanish twice; the second run (model cached) is the
 * number recorded in ADR 0027.
 */
test.skip(!process.env.BENCH, 'benchmark: run with BENCH=1');

test('translation speed on the processor', async ({ page, context }) => {
  test.setTimeout(900_000);
  const long = fixture('long-speech.wav');
  if (!existsSync(long)) {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-stream_loop',
      '29',
      '-i',
      fixture(FIXTURES.speech),
      '-c',
      'copy',
      long,
    ]);
  }
  await cacheHuggingFace(context);
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.importFixtures('long-speech.wav');
  await page.getByRole('button', { name: 'Captions' }).click();
  const captions = page.getByRole('dialog', { name: 'Auto captions' });
  await captions.getByLabel(/^Fast/).check();
  await captions.getByLabel('Language').selectOption('en');
  await captions.getByRole('button', { name: 'Create captions' }).click();
  await expect(captions).toBeHidden({ timeout: 800_000 });
  const count = ((await editor.tracks())[0]!.match(/text “/g) ?? []).length;

  const dialog = page.getByRole('dialog', { name: 'Translate captions' });
  for (const run of ['first (with download)', 'second (model cached)']) {
    await editor.clickClip(0, 1); // a caption on the top track
    await page.getByRole('button', { name: 'Translate…' }).click();
    await dialog.getByLabel('From').selectOption({ label: 'English' });
    await dialog.getByLabel('Into').selectOption({ label: 'Spanish' });
    const started = Date.now();
    await dialog.getByRole('button', { name: 'Translate' }).click();
    await expect(dialog).toBeHidden({ timeout: 800_000 });
    console.log(`Translated ${count} captions, ${run}: ${Date.now() - started} ms`);
    await editor.press('Control+z');
  }
});
