import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES, probe, toneDb } from './media';

/**
 * pauses.wav: a 440 Hz tone for 1 s, 1.5 s of silence, tone 1 s, 0.3 s of
 * silence, tone 1 s, 1 s of silence (5.8 s). With the defaults (pauses over
 * 0.5 s, keeping 0.15 s around the sound), the 1.5 s pause becomes 0.3 s, the
 * 0.3 s one stays, and the trailing second goes down to 0.15 s: 3.75 s left.
 * (Audio-only, so the clip is on row 1, under the empty video track.)
 */
test.describe('remove silences', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.pauses);
  });

  const dialog = () => editor.page.getByRole('dialog', { name: 'Remove silences' });
  const removeSilences = async () => {
    await editor.clickClip(1, 0.5);
    await editor.page.getByRole('button', { name: 'Remove silences…' }).click();
    await dialog().getByRole('button', { name: 'Reset to defaults' }).click();
    await dialog().getByRole('button', { name: 'Remove silences' }).click();
    await expect(dialog()).toBeHidden({ timeout: 60_000 });
  };

  test('cuts long pauses and closes the gaps, keeping the sound and short pauses', async () => {
    await removeSilences();
    await expect(editor.page.getByText(/^Removed 2 silences \(2\.[01] s\)\.$/)).toBeVisible();
    expect((await editor.times()).duration).toBeCloseTo(3.75, 1);

    const path = await editor.exportTo(test.info().outputDir);
    expect(Number(probe(path).format.duration)).toBeCloseTo(3.75, 1);
    const loud = (from: number, to: number) => toneDb(path, 440, from, to - from);
    // The three tones, back to back with short gaps.
    for (const [from, to] of [
      [0.1, 0.9],
      [1.4, 2.2],
      [2.7, 3.5],
    ] as const) {
      expect(loud(from, to), `${from}-${to} s`).toBeGreaterThan(-30);
    }
    // What's left of the long pause (0.3 s) and the short pause (kept whole).
    expect(loud(1.05, 1.25)).toBeLessThan(-50);
    expect(loud(2.35, 2.55)).toBeLessThan(-50);

    // One undo puts the whole clip back.
    await editor.press('Control+z');
    expect((await editor.times()).duration).toBeCloseTo(5.8, 1);
  });

  test('works in timeline time on a sped-up clip', async () => {
    await editor.clickClip(1, 0.5);
    await editor.page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('200');
    await expect.poll(async () => (await editor.times()).duration).toBeCloseTo(2.9, 1);
    await editor.page.getByRole('button', { name: 'Remove silences…' }).click();
    await dialog().getByRole('button', { name: 'Reset to defaults' }).click();
    // At 2× the pauses halve (the trailing one to 0.5 s, right at the default minimum, and
    // the pitch-keeping stretch blurs edges by a few ms), so look for pauses over 0.3 s.
    await dialog().getByLabel('Pauses longer than').fill('0.3');
    await dialog().getByRole('button', { name: 'Remove silences' }).click();
    await expect(dialog()).toBeHidden({ timeout: 60_000 });
    await expect(editor.page.getByText(/^Removed 2 silences/)).toBeVisible();
    // The 1.5 s pause plays for 0.75 s, cut to 0.3 s; the trailing 0.5 s is cut to 0.15 s;
    // the 0.15 s gap stays. In timeline time: 2.9 - 0.45 - 0.35 = 2.1 s.
    expect(Math.abs((await editor.times()).duration - 2.1)).toBeLessThan(0.08);
  });

  test('only cuts the selected clip, wherever it is on the track', async () => {
    await editor.importFixtures(FIXTURES.pauses); // a second copy, at 5.8 s
    await editor.clickClip(1, 7); // select the second one
    await editor.page.getByRole('button', { name: 'Remove silences…' }).click();
    await dialog().getByRole('button', { name: 'Reset to defaults' }).click();
    await dialog().getByRole('button', { name: 'Remove silences' }).click();
    await expect(dialog()).toBeHidden({ timeout: 60_000 });
    expect((await editor.times()).duration).toBeCloseTo(5.8 + 3.75, 1);
    const path = await editor.exportTo(test.info().outputDir);
    const loud = (from: number, to: number) => toneDb(path, 440, from, to - from);
    // The first copy is untouched: its long pause is still there.
    expect(loud(1.2, 2.3)).toBeLessThan(-50);
    // In the second, the tones close up around a 0.3 s gap.
    expect(loud(5.8 + 0.1, 5.8 + 0.9)).toBeGreaterThan(-30);
    expect(loud(5.8 + 1.05, 5.8 + 1.25)).toBeLessThan(-50);
    expect(loud(5.8 + 1.4, 5.8 + 2.2)).toBeGreaterThan(-30);
  });

  test('says when there is nothing to cut', async () => {
    await editor.clickClip(1, 0.5);
    await editor.page.getByRole('button', { name: 'Remove silences…' }).click();
    await dialog().getByLabel('Pauses longer than').fill('3');
    await dialog().getByRole('button', { name: 'Remove silences' }).click();
    await expect(dialog().getByRole('alert')).toHaveText(
      'No silences long enough to cut were found.',
    );
  });
});
