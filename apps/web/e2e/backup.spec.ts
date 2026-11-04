import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { fixture, FIXTURES } from './media';

/**
 * Inspect a backup with Python's zipfile module: an independent ZIP
 * implementation. Verifies every CRC and returns entry names and sizes.
 */
function inspectZip(path: string): { names: Record<string, number>; badCrc: string | null } {
  const script = [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'print(json.dumps({"names": {i.filename: i.file_size for i in z.infolist()}, "badCrc": z.testzip()}))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script, path]).toString()) as ReturnType<
    typeof inspectZip
  >;
}

test.describe('project backups', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto(); // no native Save dialog: backups use the download fallback
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.renameProject('Trip');
    await editor.waitSaved();
  });

  test('downloads a standard ZIP with the project and original media', async () => {
    const path = await editor.downloadBackup(test.info().outputDir);
    expect(path).toMatch(/trip-\d{4}-\d{2}-\d{2}\.framewright$/);
    const { names, badCrc } = inspectZip(path);
    expect(badCrc).toBeNull(); // every entry's checksum is valid
    expect(Object.keys(names)).toEqual(expect.arrayContaining(['project.json', 'README.txt']));
    const media = Object.entries(names).filter(([name]) => name.startsWith('media/'));
    expect(media.map(([name, size]) => [name.split('/').pop(), size]).sort()).toEqual(
      [
        [FIXTURES.audio, statSync(fixture(FIXTURES.audio)).size],
        [FIXTURES.video, statSync(fixture(FIXTURES.video)).size],
      ].sort(),
    );
  });

  test('restores a backup as a new project, media and all', async () => {
    const path = await editor.downloadBackup(test.info().outputDir);

    // Lose the original project entirely.
    const dialog = await editor.openProjects();
    await dialog.getByRole('button', { name: 'Delete this project' }).click();
    await dialog.getByRole('button', { name: /Delete “Trip” forever/ }).click();
    await expect(editor.page.locator('.project-name')).toContainText('Untitled project');

    await editor.importBackup(path);
    await expect(editor.page.locator('.project-name')).toContainText('Trip');
    await expect(editor.page.getByRole('status')).toHaveText('Imported "Trip".');
    expect((await editor.times()).duration).toBeCloseTo(6, 1);
    await expect(editor.page.locator('.banner')).toHaveCount(0); // media restored

    // It plays, with sound, from the restored media.
    await editor.press('Space');
    await editor.page.waitForTimeout(800);
    const level = await editor.meterLevel();
    await editor.press('Space');
    expect(level).toBeGreaterThan(0.05);

    // And it survives a reload like any other project.
    await editor.reload();
    expect(await editor.projectName()).toBe('Trip');
    await expect(editor.page.locator('.banner')).toHaveCount(0);
  });

  test('importing next to an existing project never overwrites it', async () => {
    const path = await editor.downloadBackup(test.info().outputDir);
    await editor.importBackup(path);
    await expect(editor.page.locator('.project-name')).toContainText('Trip (2)');
    const dialog = await editor.openProjects();
    await expect(dialog.getByRole('button', { name: 'Open Trip', exact: true })).toBeVisible();
  });

  test('rejects files that are not backups and creates nothing', async () => {
    mkdirSync(test.info().outputDir, { recursive: true });
    const fake = `${test.info().outputDir}/holiday.framewright`;
    writeFileSync(fake, 'this is not a zip file');
    await editor.importBackup(fake);
    await expect(editor.page.getByRole('status')).toContainText("isn't a valid Framewright backup");
    expect(await editor.projectName()).toBe('Trip'); // still on the same project
    // The dialog stays open so the user can pick another file; no project was added.
    const dialog = editor.page.locator('dialog[open]');
    await expect(dialog.locator('.project-list li')).toHaveCount(0);
    expect(readFileSync(fake, 'utf8')).toBe('this is not a zip file'); // untouched
  });
});
