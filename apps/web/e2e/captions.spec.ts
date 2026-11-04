import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { FIXTURES } from './media';

/**
 * Auto captions run Whisper in the browser on jfk.wav (11 s: "And so my fellow
 * Americans, ask not what your country can do for you, ask what you can do for
 * your country."). The fast (tiny) model keeps the test quick.
 */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

test.describe('auto captions', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page, context }) => {
    await cacheHuggingFace(context);
    editor = new EditorPage(page);
    await editor.goto();
  });

  const dialog = () => editor.page.getByRole('dialog', { name: 'Auto captions' });
  const run = async () => {
    await editor.page.getByRole('button', { name: 'Captions' }).click();
    await dialog().getByLabel(/^Fast/).check();
    await dialog().getByLabel('Language').selectOption('en');
    await dialog().getByRole('button', { name: 'Create captions' }).click();
  };

  test('turns speech into timed captions on a new track, undoable in one step', async () => {
    test.setTimeout(240_000); // the first run downloads the model (~41 MB)
    await editor.importFixtures(FIXTURES.speech);
    await run();
    await expect(dialog()).toBeHidden({ timeout: 200_000 });
    await expect(editor.page.getByText(/Added \d+ captions? on a new track/)).toBeVisible();

    const top = (await editor.tracks())[0]!;
    expect(top).toMatch(/^Video 2: text “/);
    const heard = words(top.replace(/ from \d\d:\d\d:\d\d to \d\d:\d\d:\d\d/g, ''));
    for (const word of ['ask', 'not', 'what', 'your', 'country', 'can', 'do', 'for', 'you']) {
      expect(heard, `"${word}" in ${top}`).toContain(word);
    }
    // Captions stay within the 11 s recording.
    const times = [...top.matchAll(/(\d\d):(\d\d):(\d\d)/g)].map(([, m, s]) => +m! * 60 + +s!);
    expect(Math.max(...times)).toBeLessThanOrEqual(11);

    await editor.press('Control+z');
    expect((await editor.tracks())[0]).not.toContain('text “');
  });

  test('a caption track can be saved as SubRip', async () => {
    test.setTimeout(240_000);
    await editor.importFixtures(FIXTURES.speech);
    await run();
    await expect(dialog()).toBeHidden({ timeout: 200_000 });
    await editor.clickClip(0, 1); // a caption on the new top track
    const download = editor.page.waitForEvent('download');
    await editor.page.getByRole('button', { name: 'Save as .srt' }).click();
    const file = await (await download).path();
    const srt = readFileSync(file, 'utf8');
    expect(srt).toMatch(/^1\n00:00:\d\d,\d{3} --> 00:00:\d\d,\d{3}\n/);
    expect(words(srt)).toContain('country');
  });

  test('silence gives no captions, rather than invented words', async () => {
    test.setTimeout(240_000);
    await editor.importFixtures(FIXTURES.silence);
    await run();
    await expect(dialog().getByRole('alert')).toHaveText('No speech was found in the sound.', {
      timeout: 200_000,
    });
    expect((await editor.tracks()).join()).not.toContain('text “');
  });

  test('explains when there is no sound to caption', async () => {
    await editor.importFixtures(FIXTURES.overlay); // a video without audio
    await run();
    await expect(dialog().getByRole('alert')).toHaveText(
      'There’s no sound on the timeline to caption.',
    );
  });
});
