import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES, toneDb } from './media';

/**
 * Under a video transition, the clips' sound crossfades too. The timeline is
 * built so both sides have spare media around the cut at 3 s:
 *
 *   440 Hz tone.webm, source 0-3 s  |  880 Hz beep.webm, source 1-4 s
 *   timeline 0-3 s                  |  timeline 3-6 s
 *
 * Each tone is measured separately with a band-pass filter. Both play at
 * -18 dBFS; with the filter, a silent tone reads -41 to -47 dB (the other
 * tone leaking through), a playing one -18 to -27 dB while it fades.
 */
const ABSENT = -36;
const PRESENT = -30;
test.describe('audio crossfades', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video); // 0-6 s
    await editor.seekTo(3);
    await editor.press('s');
    await editor.clickClip(0, 4.5);
    await editor.press('Delete'); // keep 0-3 s; source 3-6 s is spare
    await editor.importFixtures(FIXTURES.beep); // appended at 3-7 s
    await editor.seekTo(4);
    await editor.press('s');
    await editor.clickClip(0, 3.5);
    await editor.press('Delete'); // keep 4-7 s, which starts 1 s into its source
    await editor.dragClip(0, 5.5, { toSeconds: 4.5, toRow: 0 }); // back to 3-6 s, snapped
    const tracks = await editor.tracks();
    expect(tracks.find((t) => t.startsWith('Video'))).toContain('beep.webm from 00:03:00');
    await editor.clickClip(0, 4.5);
  });

  const exported = async () => {
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    return {
      a: (from: number, to: number) => toneDb(path, 440, from, to - from),
      b: (from: number, to: number) => toneDb(path, 880, from, to - from),
    };
  };

  test('a hard cut switches the sound at the cut', async () => {
    const level = await exported();
    expect(level.a(3.1, 3.4)).toBeLessThan(ABSENT);
    expect(level.b(2.6, 2.9)).toBeLessThan(ABSENT);
  });

  test('a crossfade plays both sounds across the cut, fading each', async () => {
    await editor.setTransition('crossfade', 1000);
    const level = await exported();
    const fullA = level.a(1, 2);
    const fullB = level.b(4.5, 5.5);
    // The outgoing tone carries on past the cut, the incoming one starts early...
    expect(level.a(3.1, 3.3)).toBeGreaterThan(PRESENT);
    expect(level.b(2.7, 2.9)).toBeGreaterThan(PRESENT);
    // ...each quieter than at full level, and gone outside the 2.5-3.5 s window.
    expect(level.a(3.25, 3.45)).toBeLessThan(fullA - 3);
    expect(level.b(2.55, 2.75)).toBeLessThan(fullB - 3);
    expect(level.a(3.6, 4)).toBeLessThan(ABSENT);
    expect(level.b(2, 2.4)).toBeLessThan(ABSENT);
  });

  test('a dip fades the sound out to the cut, then in', async () => {
    await editor.setTransition('dip', 1000);
    const level = await exported();
    // Neither sound crosses the cut...
    expect(level.a(3.1, 3.4)).toBeLessThan(ABSENT);
    expect(level.b(2.6, 2.9)).toBeLessThan(ABSENT);
    // ...and each is well down by the time it gets there.
    expect(level.a(2.9, 3)).toBeLessThan(level.a(1, 2) - 10);
    expect(level.b(3, 3.1)).toBeLessThan(level.b(4.5, 5.5) - 10);
  });
});
