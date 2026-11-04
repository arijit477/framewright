import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/** Video 1: tone 0-6 s, red 6-9 s. Audio 1: music 0-4 s. */
test.describe('keyboard selection on the timeline', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.importFixtures(FIXTURES.overlay);
  });

  /** The timeline's live region (what a screen reader announces). */
  const status = () => editor.page.locator('#timeline-announcement');
  const selected = async () =>
    (await editor.tracks({ withSelection: true }))
      .flatMap((t) => t.split('; '))
      .filter((c) => c.endsWith('(selected)'))
      .map((c) => c.replace(/^(Video|Audio) \d+: /, '').split(' ')[0]);
  const focusTimeline = async () => {
    await editor.timeline.focus();
    await expect(editor.timeline).toBeFocused();
  };

  test('arrow keys move between clips and tracks, with the playhead following', async () => {
    await focusTimeline();
    await editor.press('ArrowRight'); // nothing selected: the clip under the playhead
    expect(await selected()).toEqual(['tone.webm']);
    await editor.press('ArrowRight');
    expect(await selected()).toEqual(['red.webm']);
    await expect(status()).toHaveText('red.webm on Video 1, 00:06:00 to 00:09:00.');
    expect((await editor.times()).playhead).toBe(6); // exactly: no extra frame step
    await editor.press('ArrowRight'); // the last clip: stays put
    expect(await selected()).toEqual(['red.webm']);

    await editor.press('Home');
    expect(await selected()).toEqual(['tone.webm']);
    await editor.press('ArrowDown');
    expect(await selected()).toEqual(['music.wav']);
    await expect(status()).toHaveText('music.wav on Audio 1, 00:00:00 to 00:04:00.');
    await editor.press('ArrowUp');
    expect(await selected()).toEqual(['tone.webm']);
    await editor.press('End');
    expect(await selected()).toEqual(['red.webm']);
  });

  test('Shift+arrows build a selection the usual keys act on; Escape clears it', async () => {
    await focusTimeline();
    await editor.press('ArrowRight');
    await editor.press('Shift+ArrowRight');
    expect(await selected()).toEqual(['tone.webm', 'red.webm']);
    await expect(status()).toHaveText(
      'red.webm on Video 1, 00:06:00 to 00:09:00. 2 clips selected.',
    );
    await editor.press('Escape');
    expect(await selected()).toEqual([]);
    await expect(status()).toHaveText('Selection cleared.');

    // The playhead is at red (6 s) now, so the next move starts there.
    await editor.press('ArrowRight');
    await editor.press('Shift+ArrowLeft');
    expect(await selected()).toEqual(['tone.webm', 'red.webm']);
    await editor.press('Delete'); // works while the timeline has focus
    expect((await editor.tracks())[0]).toBe('Video 1: empty');
  });

  test('the timeline is reached with Tab', async () => {
    await editor.page.locator('body').focus();
    for (let i = 0; i < 40; i++) {
      await editor.press('Tab');
      if (await editor.timeline.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(editor.timeline).toBeFocused();
  });

  test('mouse users keep arrow keys for frame steps, and clicks still leave fields', async () => {
    await editor.clickClip(0, 7.5);
    const before = (await editor.times()).playhead;
    await editor.press('ArrowRight'); // one frame, not the next clip
    expect((await editor.times()).playhead).toBeCloseTo(before + 1 / 30, 2);
    expect(await selected()).toEqual(['red.webm']);
    await expect(editor.timeline).not.toBeFocused();

    // A focused slider gives up focus when the timeline is clicked, so Delete deletes the
    // clip. (Clicking the same clip keeps the panel, and so the slider, on screen.)
    await editor.page.getByRole('slider', { name: 'Volume' }).focus();
    await editor.clickClip(0, 7.5);
    await editor.press('Delete');
    expect((await editor.tracks())[0]).not.toContain('red.webm');
  });
});
