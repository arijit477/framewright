import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { fixture, FIXTURES } from './media';

/**
 * Projects persist in the browser (OPFS). Each test gets a fresh browser
 * context, so storage starts empty; reloads within a test keep it.
 */
test.describe('projects', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
  });

  test('autosaves and restores timeline, edits and media after a reload', async () => {
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.clickClip(0, 5); // video clip
    await editor.press('m'); // mute it: only the WAV should be heard
    await editor.renameProject('Holiday cut');
    await editor.waitSaved();

    await editor.reload();
    expect(await editor.projectName()).toBe('Holiday cut');
    expect((await editor.times()).duration).toBeCloseTo(6, 1);
    await expect(editor.page.locator('.preview-empty')).toHaveCount(0);
    await expect(editor.page.locator('.banner')).toHaveCount(0); // media restored from storage

    // The restored WAV plays from its stored copy; the muted video stays silent.
    await editor.seekTo(1);
    await editor.press('Space');
    await editor.page.waitForTimeout(800);
    const level = await editor.meterLevel();
    await editor.press('Space');
    expect(level).toBeGreaterThan(0.02); // WAV ≈ 0.044
    expect(level).toBeLessThan(0.1); // both together would be ≈ 0.16
  });

  test('Ctrl+S saves immediately and confirms', async () => {
    await editor.importFixtures(FIXTURES.audio);
    await editor.press('Control+s');
    await expect(editor.page.getByRole('status')).toHaveText('Project saved.');
  });

  test('keeps projects separate and switches between them', async () => {
    await editor.importFixtures(FIXTURES.video);
    await editor.renameProject('Alpha');
    await editor.waitSaved();

    await editor.newProject();
    expect((await editor.times()).duration).toBe(0);
    await editor.importFixtures(FIXTURES.audio);
    await editor.renameProject('Beta');
    await editor.waitSaved();
    expect((await editor.times()).duration).toBeCloseTo(4, 1);

    await editor.openProjectNamed('Alpha');
    expect((await editor.times()).duration).toBeCloseTo(6, 1);
    await expect(editor.page.locator('.banner')).toHaveCount(0); // its media loads from storage
    const dialog = await editor.openProjects();
    await expect(dialog.getByText('Beta')).toBeVisible();
  });

  test('deletes a project after confirmation', async () => {
    await editor.importFixtures(FIXTURES.audio);
    await editor.renameProject('Doomed');
    await editor.waitSaved();
    await editor.newProject();

    const dialog = await editor.openProjects();
    await dialog.getByRole('button', { name: 'Delete Doomed' }).click();
    await dialog.getByRole('button', { name: 'Delete forever' }).click();
    await expect(dialog.getByText('Doomed')).toHaveCount(0);

    await editor.reload();
    const after = await editor.openProjects();
    await expect(after.getByText('Doomed')).toHaveCount(0);
  });

  test('relinks media that went missing from storage', async () => {
    await editor.importFixtures(FIXTURES.audio);
    await editor.waitSaved();
    // Simulate the browser evicting the stored media copies.
    await editor.page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const projects = await root.getDirectoryHandle('projects');
      for await (const [, project] of projects.entries()) {
        if (project.kind === 'directory') {
          await (project as FileSystemDirectoryHandle).removeEntry('media', { recursive: true });
        }
      }
    });

    await editor.reload();
    const banner = editor.page.locator('.banner');
    await expect(banner).toContainText('music.wav');
    await banner.locator('input[type=file]').setInputFiles(fixture(FIXTURES.audio));
    await expect(banner).toHaveCount(0);
    await expect(editor.page.getByRole('status')).toContainText('Relinked 1');

    // The relinked copy is stored again, so it survives another reload.
    await editor.waitSaved();
    await editor.reload();
    await expect(editor.page.locator('.banner')).toHaveCount(0);
  });

  test('a project open in one tab is not opened in a second tab', async ({ context }) => {
    await editor.importFixtures(FIXTURES.video);
    await editor.renameProject('Only here');
    await editor.waitSaved();

    const second = new EditorPage(await context.newPage());
    await second.goto();
    await expect(second.page.locator('.project-name')).toContainText('Untitled project');
    expect((await second.times()).duration).toBe(0);
    // The first tab still has its project.
    expect((await editor.times()).duration).toBeCloseTo(6, 1);
  });
});
