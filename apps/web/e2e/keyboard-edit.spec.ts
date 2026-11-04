import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/** Video 1: tone 0-6 s, red 6-9 s (selected). */
test.describe('moving and trimming clips from the keyboard', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.importFixtures(FIXTURES.overlay);
    await editor.clickClip(0, 7.5);
  });

  const tracks = () => editor.tracks();
  const announcement = () => editor.page.locator('#timeline-announcement');

  test('Alt+arrows nudge by frames, as one undo step per Alt press', async () => {
    await editor.page.keyboard.down('Alt');
    await editor.press('ArrowRight'); // +1 frame
    await editor.press('ArrowRight'); // +1 frame
    await editor.press('Shift+ArrowRight'); // +10 frames
    await editor.page.keyboard.up('Alt');
    expect((await tracks())[0]).toContain('red.webm from 00:06:12 to 00:09:12');
    await expect(announcement()).toHaveText('red.webm on Video 1, 00:06:12 to 00:09:12.');
    expect((await editor.times()).playhead).toBe(0); // the playhead stays put

    await editor.press('Control+z'); // all three nudges at once
    expect((await tracks())[0]).toContain('red.webm from 00:06:00 to 00:09:00');

    // Moving left runs into tone (which ends at 6 s): refused, and said so.
    await editor.press('Alt+ArrowLeft');
    expect((await tracks())[0]).toContain('red.webm from 00:06:00');
    await expect(announcement()).toContainText('Can’t move further');
  });

  test('Alt+Up and Alt+Down move a clip between tracks, making one past the top', async () => {
    await editor.press('Alt+ArrowUp');
    let list = await tracks();
    expect(list[0]).toBe('Video 2: red.webm from 00:06:00 to 00:09:00');
    expect(list[1]).toBe('Video 1: tone.webm from 00:00:00 to 00:06:00');
    await editor.press('Alt+ArrowDown'); // back down; the emptied track goes
    list = await tracks();
    expect(list[0]).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:06:00; red.webm from 00:06:00 to 00:09:00',
    );
  });

  test('[ and ] trim the selected clip to the playhead; , and . step frames', async () => {
    await editor.seekTo(7);
    await editor.press('.');
    await editor.press('Shift+.'); // ">" with Shift: 10 frames
    expect((await editor.times()).playhead).toBeCloseTo(7 + 11 / 30, 2);
    await editor.press('Shift+,');
    await editor.press(',');
    expect((await editor.times()).playhead).toBeCloseTo(7, 2);

    await editor.press('[');
    expect((await tracks())[0]).toContain('red.webm from 00:07:00 to 00:09:00');
    await editor.seekTo(8);
    await editor.press(']');
    expect((await tracks())[0]).toContain('red.webm from 00:07:00 to 00:08:00');
    await editor.press('Control+z');
    expect((await tracks())[0]).toContain('red.webm from 00:07:00 to 00:09:00');

    await editor.seekTo(2); // not inside red
    await editor.press('[');
    await expect(editor.page.getByText('Move the playhead inside the selected clip')).toBeVisible();
  });

  test('with ripple on, [ keeps the clip in place and pulls the rest along', async () => {
    await editor.page.getByRole('button', { name: 'Ripple', exact: true }).click();
    await editor.clickClip(0, 3); // tone
    await editor.seekTo(2);
    await editor.press('[');
    expect((await tracks())[0]).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:04:00; red.webm from 00:04:00 to 00:07:00',
    );
  });
});
