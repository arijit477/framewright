import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES } from './media';

/** Video: tone 0-6 s, red 6-9 s. Audio: music 0-4 s. */
test.describe('editing several clips at once', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
    await editor.importFixtures(FIXTURES.overlay);
  });

  const panel = () => editor.page.getByRole('complementary', { name: 'Clip settings' });
  const readout = (name: string) =>
    panel().getByRole('slider', { name, exact: true }).getAttribute('aria-valuetext');
  const selectBoth = async () => {
    await editor.clickClip(0, 3);
    await editor.clickClip(0, 7.5, { modifier: 'Control' });
  };

  test('a colour change sets just that value on every selected clip', async () => {
    await editor.clickClip(0, 3);
    await editor.setSlider('Saturation', -100); // tone only
    await selectBoth();
    await expect(panel().getByText('2 clips selected')).toBeVisible();
    expect(await readout('Saturation')).toBe('Mixed');

    await editor.setSlider('Brightness', 30);
    await editor.clickClip(0, 3);
    expect(await readout('Brightness')).toBe('30');
    expect(await readout('Saturation')).toBe('-100'); // kept
    await editor.clickClip(0, 7.5);
    expect(await readout('Brightness')).toBe('30');
    expect(await readout('Saturation')).toBe('0'); // kept

    await editor.press('Control+z'); // one step for both clips
    expect(await readout('Brightness')).toBe('0');
    await editor.clickClip(0, 3);
    expect(await readout('Brightness')).toBe('0');
  });

  test('a look applies to all of them and shows as chosen', async () => {
    await selectBoth();
    const look = panel().getByRole('button', { name: 'Black & white' });
    await look.click();
    await expect(look).toHaveAttribute('aria-pressed', 'true');
    await editor.clickClip(0, 3);
    expect(await readout('Saturation')).toBe('-100');
  });

  test('speed changes every selected clip, rippling the rest along', async () => {
    await editor.page.getByRole('button', { name: 'Ripple', exact: true }).click();
    await selectBoth();
    await panel().getByRole('combobox', { name: 'Speed', exact: true }).selectOption('200');
    expect((await editor.tracks())[0]).toBe(
      'Video 1: tone.webm from 00:00:00 to 00:03:00 at 2× speed; ' +
        'red.webm from 00:03:00 to 00:04:15 at 2× speed',
    );
  });

  test('volume and mute apply to video and audio clips alike; titles are left out', async () => {
    await editor.clickClip(0, 3);
    await editor.clickClip(1, 2, { modifier: 'Control' });
    await editor.setSlider('Volume', 50);
    await editor.press('m');
    await expect(panel().getByRole('button', { name: 'Unmute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const [track, at] of [
      [0, 3],
      [1, 2],
    ] as const) {
      await editor.clickClip(track, at);
      expect(await readout('Volume')).toBe('50%');
      await expect(panel().getByRole('button', { name: 'Unmute' })).toBeVisible();
    }
    // Colour is only for clips with a picture: just the video clip here.
    await editor.clickClip(0, 3);
    await editor.clickClip(1, 2, { modifier: 'Control' });
    await expect(panel().getByRole('region', { name: 'Color (2 clips)' })).toHaveCount(0);
    await expect(panel().getByRole('region', { name: 'Color' })).toBeVisible();
    await expect(panel().getByRole('region', { name: 'Transform' })).toHaveCount(0);

    await editor.seekTo(1);
    await editor.addTitle('Hello');
    await editor.clickClip(1, 7.5, { modifier: 'Control' }); // the title is on a new top row; red below
    await expect(panel().getByText('1 title not affected', { exact: false })).toBeVisible();
  });
});
