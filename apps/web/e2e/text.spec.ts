import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { fixture, FIXTURES, frameDifference, frameRgb } from './media';

/** Tightly around where a default one-line title sits on a 1280×720 export. */
const TITLE_REGION = { crop: '400:70:440:555', width: 120, height: 24 };
/** H.264 export vs VP9 source differ by ~5 from encoding alone (measured). */
const NOISE = 8;

test.describe('text overlays', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video); // 0-6 s
  });

  test('a title is burned into the export, only while it is on screen', async () => {
    await editor.seekTo(1);
    await editor.addTitle('HELLO WORLD');
    expect(await editor.tracks()).toEqual([
      'Video 2: text “HELLO WORLD” from 00:01:00 to 00:04:00',
      'Video 1: tone.webm from 00:00:00 to 00:06:00',
      'Audio 1: empty',
    ]);

    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    const source = fixture(FIXTURES.video);
    // Compare the title area of the export with the same moment of the source.
    const changedAt = (seconds: number) =>
      frameDifference(
        frameRgb(path, seconds, TITLE_REGION),
        frameRgb(source, seconds, TITLE_REGION),
      );

    const during = changedAt(2.5);
    expect(during).toBeGreaterThan(25); // the text is burned in (measured ≈ 35)...
    expect(changedAt(0.5)).toBeLessThan(NOISE); // ...but not before the clip
    expect(changedAt(5)).toBeLessThan(NOISE); // ...or after it
    // Fade in: invisible on the clip's first frame, partly visible soon after.
    expect(changedAt(1.0)).toBeLessThan(NOISE);
    const fading = changedAt(1.1);
    expect(fading).toBeGreaterThan(NOISE);
    expect(fading).toBeLessThan(during);
  });

  test('typing in the text box never triggers shortcuts', async () => {
    await editor.seekTo(2);
    await editor.press('t');
    const field = editor.page.getByLabel('Text content');
    // S would split, Space would play, Backspace would delete the selected clip.
    await field.press('Control+a');
    await field.pressSequentially('see you soon');
    await field.press('Backspace');
    await field.press('Space');
    await field.blur();
    expect(await editor.tracks()).toEqual([
      'Video 2: text “see you soo ” from 00:02:00 to 00:05:00',
      'Video 1: tone.webm from 00:00:00 to 00:06:00',
      'Audio 1: empty',
    ]);
    await expect(editor.page.getByRole('button', { name: 'Play' })).toBeVisible(); // not playing
  });

  test('title edits can be undone and are saved with the project', async () => {
    await editor.seekTo(1);
    await editor.addTitle('First draft');
    const field = editor.page.getByLabel('Text content');
    await field.fill('Final title');
    await field.blur();
    const title = async () => (await editor.tracks())[0];
    expect(await title()).toContain('text “Final title”');

    await editor.press('Control+z');
    expect(await title()).toContain('text “First draft”');
    await expect(field).toHaveValue('First draft'); // the inspector follows undo
    await editor.press('Control+Shift+z');
    expect(await title()).toContain('text “Final title”');

    await editor.waitSaved();
    await editor.reload();
    expect(await title()).toContain('text “Final title”');
  });

  test('an empty title is not saved', async () => {
    await editor.seekTo(1);
    await editor.addTitle('Keep me');
    const field = editor.page.getByLabel('Text content');
    await field.fill('   ');
    await expect(editor.page.getByText('Text can’t be empty')).toBeVisible();
    await field.blur();
    expect((await editor.tracks())[0]).toContain('text “Keep me”');
  });
});
