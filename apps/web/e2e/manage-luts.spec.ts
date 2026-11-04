import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { fixture, FIXTURES } from './media';

/** A second LUT (an identity), made on the fly. */
const PLAIN = {
  name: 'plain.cube',
  mimeType: 'text/plain',
  buffer: Buffer.from(
    'TITLE "Plain"\nLUT_3D_SIZE 2\n' +
      Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n'),
  ),
};

test.describe('managing LUTs', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.clickClip(0, 1.5);
    await page.getByLabel('LUT file').setInputFiles(fixture(FIXTURES.lut)); // "Swap", applied
  });

  const lutSelect = () => editor.page.getByLabel('LUT', { exact: true });
  const dialog = () => editor.page.getByRole('dialog', { name: 'LUTs in this project' });
  const manage = async () => {
    await editor.page.getByRole('button', { name: 'Manage LUTs…' }).click();
    await expect(dialog()).toBeVisible();
  };
  const done = () => dialog().getByRole('button', { name: 'Done' }).click();

  test('a LUT in use cannot be removed; once unused it can, and undo brings it back', async () => {
    await manage();
    await expect(dialog().getByText('used by 1 clip')).toBeVisible();
    await expect(dialog().getByRole('button', { name: 'Remove Swap' })).toBeDisabled();
    await done();

    await lutSelect().selectOption('');
    await manage();
    await dialog().getByRole('button', { name: 'Remove Swap' }).click();
    await expect(dialog().getByText('No LUTs yet')).toBeVisible();
    await done();
    await expect(lutSelect().locator('option')).toHaveText(['None']);

    // Undoing "None" puts the LUT back on the clip, and back in the project.
    await editor.press('Control+z');
    await expect(lutSelect().locator('option:checked')).toHaveText('Swap');
  });

  test('renaming is saved with the project', async () => {
    await manage();
    const name = dialog().getByLabel('Name of LUT Swap');
    await name.fill('  Teal   look ');
    await name.press('Enter');
    // Tidied, and the field is now labelled with the new name.
    await expect(dialog().getByLabel('Name of LUT Teal look')).toHaveValue('Teal look');
    await done();
    await expect(lutSelect().locator('option:checked')).toHaveText('Teal look');
    await editor.waitSaved();
    await editor.reload();
    await editor.clickClip(0, 1.5);
    await expect(lutSelect().locator('option:checked')).toHaveText('Teal look');
  });

  test('"Remove unused" keeps only the LUTs clips use, also after a reload', async () => {
    await editor.page.getByLabel('LUT file').setInputFiles(PLAIN); // replaces Swap on the clip
    await expect(lutSelect().locator('option')).toHaveText(['None', 'Plain', 'Swap']);
    await manage();
    await dialog().getByRole('button', { name: 'Remove unused (1)' }).click();
    await expect(dialog().getByRole('listitem')).toHaveCount(1);
    await done();
    await expect(lutSelect().locator('option')).toHaveText(['None', 'Plain']);
    await editor.waitSaved();
    await editor.reload();
    await editor.clickClip(0, 1.5);
    await expect(lutSelect().locator('option')).toHaveText(['None', 'Plain']);
  });

  test('copied clips bring their LUT along, even after it was removed and the project reopened', async () => {
    await editor.renameProject('Graded');
    await editor.press('Control+c'); // the graded clip (selected since the LUT was applied)
    await lutSelect().selectOption('');
    await manage();
    await dialog().getByRole('button', { name: 'Remove Swap' }).click();
    await done();
    await editor.waitSaved();
    // Opening another project and coming back forgets this session's removed LUTs;
    // only the clipboard still has it.
    await editor.newProject();
    await editor.openProjectNamed('Graded');
    expect(await editor.tracks()).toContain('Video 1: tone.webm from 00:00:00 to 00:06:00');
    await editor.seekTo(6);
    await editor.press('Control+v'); // the pasted clip is selected
    await expect(lutSelect().locator('option:checked')).toHaveText('Swap');
  });
});
