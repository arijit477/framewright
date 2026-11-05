import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { FIXTURES, frameRgb } from './media';

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
  const run = async ({ highlight = true } = {}) => {
    await editor.page.getByRole('button', { name: 'Captions' }).click();
    await dialog().getByLabel(/^Fast/).check();
    await dialog().getByLabel('Language').selectOption('en');
    await dialog().getByLabel('Highlight each word as it’s spoken').setChecked(highlight);
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

  /**
   * The caption band (bottom of a 720p frame): how many pixels are in the
   * highlight colour (#facc15) and white (the other words), and the mean x of
   * the highlighted ones.
   */
  const captionPixels = (path: string, seconds: number) => {
    const rgb = frameRgb(path, seconds, { crop: '1280:200:0:520', width: 1280, height: 200 });
    let yellow = 0;
    let white = 0;
    let x = 0;
    for (let i = 0; i < rgb.length; i += 3) {
      const [r, g, b] = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
      if (r > 190 && g > 150 && g < 235 && b < 100) {
        yellow++;
        x += (i / 3) % 1280;
      } else if (r > 200 && g > 200 && b > 200) {
        white++;
      }
    }
    return { yellow, white, x: yellow ? x / yellow : NaN };
  };

  test('each word lights up as it is spoken in the export, and only that word', async () => {
    test.setTimeout(300_000);
    await editor.importFixtures(FIXTURES.speech);
    await run();
    await expect(dialog()).toBeHidden({ timeout: 200_000 });
    const lit = await editor.exportTo(test.info().outputDir, { resolution: '720p' });
    const moments = [2, 2.6, 5, 8].map((s) => captionPixels(lit, s));
    for (const m of moments) {
      expect(m.yellow, JSON.stringify(m)).toBeGreaterThan(100);
      expect(m.yellow, JSON.stringify(m)).toBeLessThan(m.white / 2); // one word, not the line
    }
    // A moment later, a different word is lit.
    expect(Math.abs(moments[0]!.x - moments[1]!.x)).toBeGreaterThan(20);

    await editor.press('Control+z');
    await run({ highlight: false });
    await expect(dialog()).toBeHidden({ timeout: 200_000 });
    const plain = await editor.exportTo(test.info().outputDir, { resolution: '720p' });
    for (const s of [2, 2.6, 5, 8]) {
      const m = captionPixels(plain, s);
      expect(m.yellow).toBe(0);
      expect(m.white).toBeGreaterThan(500); // the captions are still there
    }
  });

  test('word timings survive fixing a word, and are dropped when words are added', async () => {
    test.setTimeout(240_000);
    await editor.importFixtures(FIXTURES.speech);
    await run();
    await expect(dialog()).toBeHidden({ timeout: 200_000 });
    await editor.clickClip(0, 1);
    const highlight = editor.page.getByLabel('Highlight each word as it’s spoken');
    await expect(highlight).toBeChecked();
    await expect(editor.page.getByLabel('Highlight colour')).toHaveValue('#facc15');

    const text = editor.page.getByLabel('Text content');
    const original = await text.inputValue();
    // Same number of words: the timings (and the control) stay.
    await text.fill(original.replace(/\S+/, 'Hello'));
    await text.blur();
    await expect.poll(async () => (await editor.tracks())[0]).toContain('“Hello');
    await expect(highlight).toBeVisible();
    // One more word: the timings can't be kept.
    await text.fill(`${original} again`);
    await text.blur();
    await expect(
      editor.page.getByText('Word highlighting was removed because the number of words changed.'),
    ).toBeVisible();
    await expect(highlight).toBeHidden();
    await editor.press('Control+z');
    await expect(highlight).toBeVisible();
  });
});
