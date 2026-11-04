import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

test.describe('editing', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
  });

  test('imports video and audio onto their tracks', async () => {
    expect((await editor.times()).duration).toBeCloseTo(6, 1);
    await expect(editor.page.locator('.status')).toContainText('audio clock');
  });

  test('the toolbar fits on one row at 1280 px, even with a clip selected', async () => {
    // Fonts differ between systems (CI's are wider), so the toolbar keeps plenty of slack:
    // per-clip settings live in the clip panel, not here.
    await editor.clickClip(0, 3);
    const toolbar = editor.page.locator('.toolbar');
    const buttonHeight = await toolbar
      .getByRole('button', { name: 'Import' })
      .evaluate((el) => el.getBoundingClientRect().height);
    const height = await toolbar.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(buttonHeight * 2); // a second row would double it
    // And the clip's settings are in the clip panel.
    const panel = editor.page.getByRole('complementary', { name: 'Clip settings' });
    await expect(panel.getByRole('combobox', { name: 'Speed', exact: true })).toBeVisible();
    await expect(panel.getByRole('slider', { name: 'Volume' })).toBeVisible();
  });

  test('audio-only clips get the clip panel too, without transform or colour', async () => {
    await editor.clickClip(1, 1); // the WAV on the audio track
    const panel = editor.page.getByRole('complementary', { name: 'Clip settings' });
    await expect(panel.getByRole('button', { name: 'Mute' })).toBeVisible();
    await expect(panel.getByRole('region', { name: 'Transform' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Mute' }).click();
    await expect(panel.getByRole('button', { name: 'Unmute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('split, delete and undo', async () => {
    await editor.seekTo(3);
    await editor.press('s');
    await editor.clickClip(0, 4.5); // right half
    await editor.press('Delete');
    // The audio clip (4 s) now defines the end of the timeline.
    await expect.poll(async () => (await editor.times()).duration).toBeCloseTo(4, 1);
    await editor.press('Control+z');
    await expect.poll(async () => (await editor.times()).duration).toBeCloseTo(6, 1);
  });

  test('playback follows the audio clock and produces sound', async () => {
    await editor.press('Space');
    await editor.page.waitForTimeout(1500);
    const level = await editor.meterLevel();
    await editor.press('Space');
    const { playhead } = await editor.times();
    // Real time, give or take audio start-up latency.
    expect(playhead).toBeGreaterThan(1.0);
    expect(playhead).toBeLessThan(2.0);
    expect(level).toBeGreaterThan(0.05);
    expect(await editor.status()).toContain('audio clock');
  });

  test('a muted clip is silent', async () => {
    await editor.clickClip(0, 5); // video clip
    await editor.press('m');
    await editor.seekTo(4.5); // after the WAV ends
    await editor.press('Space');
    await editor.page.waitForTimeout(700);
    const level = await editor.meterLevel();
    await editor.press('Space');
    expect(level).toBeLessThan(0.001);
  });
});
