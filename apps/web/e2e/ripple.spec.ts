import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/**
 * One video track: tone 0-6 s, tone 6-12 s, red 12-15 s. Ripple edits are
 * checked through the accessible track list, which states every clip's span.
 */
test.describe('ripple editing', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.importFixtures(FIXTURES.video);
    await editor.importFixtures(FIXTURES.overlay);
    expect(await videoTrack()).toContain('red.webm from 00:12:00 to 00:15:00');
  });

  const videoTrack = async () => (await editor.tracks()).find((t) => t.startsWith('Video'))!;
  const rippleButton = () => editor.page.getByRole('button', { name: 'Ripple', exact: true });

  test('Delete leaves a gap; Shift+Delete closes it', async () => {
    await editor.clickClip(0, 8);
    await editor.press('Delete');
    expect(await videoTrack()).toContain('red.webm from 00:12:00 to 00:15:00');
    await editor.press('Control+z');

    await editor.clickClip(0, 8);
    await editor.press('Shift+Delete');
    expect(await videoTrack()).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:06:00; red.webm from 00:06:00 to 00:09:00',
    );
    await editor.press('Control+z'); // one step brings it all back
    expect(await videoTrack()).toContain('red.webm from 00:12:00 to 00:15:00');
  });

  test('with ripple on, deleting and changing speed move the later clips', async () => {
    await rippleButton().click();
    await expect(rippleButton()).toHaveAttribute('aria-pressed', 'true');

    await editor.clickClip(0, 8);
    await editor.page.getByRole('button', { name: 'Delete', exact: true }).click();
    expect(await videoTrack()).toContain('red.webm from 00:06:00 to 00:09:00');

    // Slowing down now pushes the rest along instead of failing for lack of room.
    await editor.clickClip(0, 3);
    await editor.page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('50');
    expect(await videoTrack()).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:12:00 at 0.5× speed; red.webm from 00:12:00 to 00:15:00',
    );
  });

  test('a ripple trim keeps the clip in place and pulls the rest along', async () => {
    await rippleButton().click();
    // Drag the first clip's start edge from 0 s to 2 s: it loses its first two seconds.
    await editor.dragClip(0, 0.02, { toSeconds: 2, toRow: 0 });
    expect(await videoTrack()).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:04:00; tone.webm from 00:04:00 to 00:10:00; ' +
        'red.webm from 00:10:00 to 00:13:00',
    );
    await editor.press('Control+z');

    // Without ripple, the same drag just moves the start edge.
    await rippleButton().click();
    await editor.dragClip(0, 0.02, { toSeconds: 2, toRow: 0 });
    expect(await videoTrack()).toContain(
      'tone.webm from 00:02:00 to 00:06:00; tone.webm from 00:06:00',
    );
  });

  test('the ripple setting is remembered', async () => {
    await rippleButton().click();
    await editor.waitSaved();
    await editor.reload();
    await expect(rippleButton()).toHaveAttribute('aria-pressed', 'true');
  });
});
