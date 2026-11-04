import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/**
 * Video: tone 0-6 s, red 6-9 s. Audio: music 0-4 s. Selection and clipboard
 * results are read from the accessible track list, which marks selected clips.
 */
test.describe('multi-select and clipboard', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.importFixtures(FIXTURES.overlay);
  });

  const track = async (name: 'Video' | 'Audio') =>
    (await editor.tracks({ withSelection: true })).find((t) => t.startsWith(name))!;
  const selectedCount = async () =>
    (await editor.tracks({ withSelection: true })).join(' ').split('(selected)').length - 1;

  test('Ctrl-click builds a selection that deletes in one step', async () => {
    await editor.clickClip(0, 7.5);
    await editor.clickClip(1, 2, { modifier: 'Control' });
    expect(await selectedCount()).toBe(2);
    await editor.clickClip(1, 2, { modifier: 'Control' }); // and takes one out again
    expect(await selectedCount()).toBe(1);
    await editor.clickClip(1, 2, { modifier: 'Shift' });

    await editor.press('Delete');
    expect(await track('Video')).not.toContain('red.webm');
    expect(await track('Audio')).not.toContain('music.wav');
    await editor.press('Control+z');
    expect(await track('Video')).toContain('red.webm');
    expect(await track('Audio')).toContain('music.wav');
  });

  test('Ctrl+A selects everything; a plain click narrows it again', async () => {
    await editor.clickClip(0, 1);
    await editor.press('Control+a');
    expect(await selectedCount()).toBe(3);
    await editor.clickClip(0, 7.5);
    expect(await selectedCount()).toBe(1);
    expect(await track('Video')).toContain('red.webm from 00:06:00 to 00:09:00 (selected)');
  });

  test('dragging one selected clip moves the whole selection, each on its track', async () => {
    await editor.clickClip(0, 7.5);
    await editor.clickClip(1, 2, { modifier: 'Control' });
    await editor.dragClip(0, 7.5, { toSeconds: 9.5, toRow: 0 });
    expect(await track('Video')).toContain('red.webm from 00:08:00 to 00:11:00');
    expect(await track('Audio')).toContain('music.wav from 00:02:00 to 00:06:00');
    await editor.press('Control+z'); // one step for the group
    expect(await track('Audio')).toContain('music.wav from 00:00:00 to 00:04:00');
  });

  test('copy and paste at the playhead, onto a new track when there is no room', async () => {
    await editor.clickClip(0, 7.5);
    await editor.press('Control+c');
    await expect(editor.page.getByText('Copied 1 clip.')).toBeVisible();

    await editor.seekTo(12); // the playhead stops at the end of the timeline (9 s)
    await editor.press('Control+v');
    expect(await track('Video')).toContain(
      'red.webm from 00:06:00 to 00:09:00; red.webm from 00:09:00 to 00:12:00 (selected)',
    );

    // Pasting over existing clips makes a new layer instead of overwriting.
    await editor.seekTo(1);
    await editor.press('Control+v');
    const tracks = await editor.tracks({ withSelection: true });
    expect(tracks[0]).toBe('Video 2: red.webm from 00:01:00 to 00:04:00 (selected)');
    expect(tracks[1]).toContain('tone.webm from 00:00:00 to 00:06:00; red.webm');
  });

  test('cut removes, and paste brings back', async () => {
    await editor.clickClip(1, 2);
    await editor.press('Control+x');
    expect(await track('Audio')).not.toContain('music.wav');
    await editor.seekTo(5);
    await editor.press('Control+v');
    expect(await track('Audio')).toContain('music.wav from 00:05:00 to 00:09:00');
  });

  test('shortcuts leave text fields alone', async () => {
    await editor.addTitle('Hello');
    const field = editor.page.getByLabel('Text content');
    await field.focus();
    await editor.press('Control+a'); // selects the text, not every clip
    await editor.press('Control+c'); // copies the text, not the clip
    await editor.page.waitForTimeout(300); // let any (wrong) reaction render before checking
    expect(await selectedCount()).toBe(1); // just the title
    await expect(editor.page.getByText(/Copied \d+ clips?\./)).toHaveCount(0);
  });
});
