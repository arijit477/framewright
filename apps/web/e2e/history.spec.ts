import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { fixture, FIXTURES } from './media';

/** Undo history is saved with the project: closing the tab or reloading keeps it. */
test.describe('undo history across reloads', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
  });

  const undoButton = () => editor.page.getByRole('button', { name: 'Undo' });
  const redoButton = () => editor.page.getByRole('button', { name: 'Redo' });
  const video = async () => (await editor.tracks())[0]!;

  test('edits can be undone and redone after a reload', async () => {
    const imported = await video();
    await editor.seekTo(2);
    await editor.clickClip(0, 1);
    await editor.page.getByRole('button', { name: 'Split' }).click();
    const split = await video();
    expect(split).not.toBe(imported);
    await editor.addTitle('Hello');
    const titled = await editor.tracks();

    await editor.waitSaved();
    await editor.reload();
    expect(await editor.tracks()).toEqual(titled);
    await expect(undoButton()).toBeEnabled();

    await undoButton().click(); // the title's text...
    expect((await editor.tracks()).join()).not.toContain('Hello');
    await undoButton().click(); // ...and the title itself
    expect((await editor.tracks()).join()).not.toContain('text “');
    await undoButton().click(); // the split
    expect(await video()).toBe(imported);
    await undoButton().click(); // the import
    await expect(undoButton()).toBeDisabled();

    // The redo steps are saved too.
    await editor.waitSaved();
    await editor.reload();
    await expect(redoButton()).toBeEnabled();
    await redoButton().click(); // the import
    await redoButton().click(); // the split
    expect(await video()).toBe(split);
  });

  test('a LUT removed from the project comes back when undo brings back its use', async () => {
    await editor.clickClip(0, 1.5);
    await editor.page.getByLabel('LUT file').setInputFiles(fixture(FIXTURES.lut)); // "Swap"
    const lut = editor.page.getByLabel('LUT', { exact: true });
    await expect(lut.locator('option:checked')).toHaveText('Swap');
    await lut.selectOption(''); // no LUT on the clip...
    await editor.page.getByRole('button', { name: 'Manage LUTs…' }).click();
    const dialog = editor.page.getByRole('dialog', { name: 'LUTs in this project' });
    await dialog.getByRole('button', { name: 'Remove Swap' }).click(); // ...and none in the project
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(lut.locator('option')).toHaveText(['None']);

    await editor.waitSaved();
    await editor.reload();
    await undoButton().click(); // brings back "Swap" on the clip, and so in the project
    await editor.clickClip(0, 1.5);
    await expect(
      editor.page.getByLabel('LUT', { exact: true }).locator('option:checked'),
    ).toHaveText('Swap');
  });
});
