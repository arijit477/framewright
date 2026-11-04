import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/** Video: tone 0-6 s, red 6-9 s. Audio: music 0-4 s. */
test.describe('duplicate', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.importFixtures(FIXTURES.overlay);
  });

  const tracks = () => editor.tracks({ withSelection: true });
  const ripple = () => editor.page.getByRole('button', { name: 'Ripple', exact: true }).click();

  test('Ctrl+D puts a copy right after the clip and selects it; undo removes it', async () => {
    await editor.clickClip(0, 7.5);
    await editor.press('Control+d');
    expect((await tracks())[0]).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:06:00; red.webm from 00:06:00 to 00:09:00; ' +
        'red.webm from 00:09:00 to 00:12:00 (selected)',
    );
    await editor.press('Control+z');
    expect((await tracks())[0]).not.toContain('00:12:00');
  });

  test('without ripple, a copy that does not fit goes on a new track', async () => {
    await editor.clickClip(0, 3);
    await editor.page.getByRole('button', { name: 'Duplicate' }).click();
    const [top, main] = await tracks();
    expect(top).toBe('Video 2: tone.webm from 00:06:00 to 00:12:00 (selected)');
    expect(main).toContain('red.webm from 00:06:00 to 00:09:00');
  });

  test('with ripple, the copy is inserted and later clips move along', async () => {
    await ripple();
    await editor.clickClip(0, 3);
    await editor.press('Control+d');
    expect((await tracks())[0]).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:06:00; tone.webm from 00:06:00 to 00:12:00 (selected); ' +
        'red.webm from 00:12:00 to 00:15:00',
    );
  });

  test('a multi-track selection is duplicated as a block after itself', async () => {
    await editor.clickClip(0, 7.5);
    await editor.clickClip(1, 2, { modifier: 'Control' });
    await editor.press('Control+d');
    // The block spans 0-9 s (music 0-4, red 6-9), so the copies start at 9 s, spaced the same.
    const [video, audio] = await tracks();
    expect(video).toContain('red.webm from 00:15:00 to 00:18:00 (selected)');
    expect(audio).toContain('music.wav from 00:09:00 to 00:13:00 (selected)');
  });

  test('duplicating leaves the clipboard alone', async () => {
    await editor.clickClip(1, 2);
    await editor.press('Control+c');
    await editor.clickClip(0, 7.5);
    await editor.press('Control+d');
    await editor.seekTo(5);
    await editor.press('Control+v'); // the music, not the red clip
    const audio = (await tracks()).find((t) => t.startsWith('Audio'));
    expect(audio).toContain('music.wav from 00:05:00 to 00:09:00 (selected)');
  });
});
