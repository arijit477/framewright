import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/** Video: tone 0-6 s, red 6-9 s. Audio: music 0-4 s (display rows 0 and 1). */
test.describe('selection box', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.importFixtures(FIXTURES.overlay);
  });

  const selected = async () =>
    (await editor.tracks({ withSelection: true }))
      .flatMap((t) => t.split('; '))
      .filter((c) => c.endsWith('(selected)'))
      .map((c) => c.replace(/^(Video|Audio) \d+: /, '').split(' ')[0]);

  test('dragging on empty space selects every clip the box touches', async () => {
    // From empty audio space at 7 s up and back to 5 s on the video row.
    await editor.dragBox({ row: 1, seconds: 7 }, { row: 0, seconds: 5 });
    expect(await selected()).toEqual(['tone.webm', 'red.webm']);
    // The playhead didn't move.
    expect((await editor.times()).playhead).toBe(0);

    await editor.press('Delete'); // and acts on the selection like any other
    expect((await editor.tracks())[0]).toBe('Video 1: empty');
  });

  test('a box with Ctrl held adds to the selection', async () => {
    await editor.clickClip(1, 2); // music
    await editor.dragBox({ row: 1, seconds: 8.5 }, { row: 0, seconds: 7 }, { modifier: 'Control' });
    expect(await selected()).toEqual(['red.webm', 'music.wav']);
    // Without Ctrl, a new box replaces it.
    await editor.dragBox({ row: 1, seconds: 8.5 }, { row: 1, seconds: 3 });
    expect(await selected()).toEqual(['music.wav']);
  });

  test('a click on empty space deselects and moves the playhead', async () => {
    await editor.clickClip(0, 7.5);
    expect(await selected()).toEqual(['red.webm']);
    await editor.clickClip(1, 6); // empty audio space
    expect(await selected()).toEqual([]);
    expect((await editor.times()).playhead).toBeCloseTo(6, 1);
  });
});
