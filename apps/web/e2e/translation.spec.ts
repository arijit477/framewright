import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { FIXTURES } from './media';

/**
 * Caption translation with OPUS-MT on the device: captions from jfk.wav
 * ("…ask not what your | country can do for you…", one sentence over two
 * captions) translated into Spanish, then
 * the Spanish into Hindi (no direct model: through English).
 */
test.describe('caption translation', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(400_000); // first runs download the models
    await cacheHuggingFace(context);
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.speech);
    await page.getByRole('button', { name: 'Captions' }).click();
    const captions = page.getByRole('dialog', { name: 'Auto captions' });
    await captions.getByLabel(/^Fast/).check();
    await captions.getByLabel('Language').selectOption('en');
    await captions.getByRole('button', { name: 'Create captions' }).click();
    await expect(captions).toBeHidden({ timeout: 200_000 });
  });

  const dialog = () => editor.page.getByRole('dialog', { name: 'Translate captions' });
  const translate = async (from: string, to: string) => {
    await editor.page.getByRole('button', { name: 'Translate…' }).click();
    await dialog().getByLabel('From').selectOption({ label: from });
    await dialog().getByLabel('Into').selectOption({ label: to });
    await dialog().getByRole('button', { name: 'Translate' }).click();
    await expect(dialog()).toBeHidden({ timeout: 300_000 });
  };
  /** Each caption's time range on a track ("from 00:00:20 to 00:06:12"). */
  const times = (track: string) => [...track.matchAll(/from \S+ to \S+/g)].map((m) => m[0]);
  /** A track's caption texts joined into one, as read in order. */
  const reading = (track: string) =>
    [...track.matchAll(/text “([^”]*)”/g)].map((m) => m[1]!.replace(/\s+/g, ' ')).join(' ');

  test('adds a translated copy of a caption track at the same times', async () => {
    const english = (await editor.tracks())[0]!;
    await editor.clickClip(0, 1);
    await editor.page.getByRole('button', { name: 'Translate…' }).click();
    await expect(dialog().getByTestId('translation-route')).toContainText('About 113 MB');
    await dialog().getByRole('button', { name: 'Close' }).click();

    await translate('English', 'Spanish');
    await expect(editor.page.getByText(/^Translated \d+ captions? into Spanish/)).toBeVisible();
    const [spanish, original] = await editor.tracks();
    expect(original).toBe(english);
    expect(spanish).toMatch(/^Video 3: text “/);
    expect(times(spanish!)).toEqual(times(english));
    expect(spanish!.toLowerCase()).toMatch(/país/);
    expect(spanish).not.toMatch(/country/i);
    // The sentence split over two captions ("…what your | country can do for you…")
    // is translated whole, so its grammar survives the split.
    expect(reading(spanish!)).toContain('qué puede hacer su país por usted');

    await editor.press('Control+z');
    expect((await editor.tracks())[0]).toBe(english);
  });

  test('languages without a direct model go through English', async () => {
    await editor.clickClip(0, 1);
    await translate('English', 'Spanish');
    await editor.clickClip(0, 1); // a Spanish caption
    await editor.page.getByRole('button', { name: 'Translate…' }).click();
    await dialog().getByLabel('From').selectOption({ label: 'Spanish' });
    await dialog().getByLabel('Into').selectOption({ label: 'Hindi' });
    await expect(dialog().getByTestId('translation-route')).toContainText(
      'Goes through English (two models)',
    );
    await dialog().getByRole('button', { name: 'Translate' }).click();
    await expect(dialog().getByText(/step 2 of 2/)).toBeVisible({ timeout: 300_000 });
    await expect(dialog()).toBeHidden({ timeout: 300_000 });
    const hindi = (await editor.tracks())[0]!;
    expect(hindi).toMatch(/[ऀ-ॿ]{3}/); // Devanagari
  });
});
