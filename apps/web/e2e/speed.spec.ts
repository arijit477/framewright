import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { fixture, FIXTURES, maskDifference, probe, timestampMask, toneDb } from './media';

/**
 * tone.webm is a 6 s moving test pattern with a 440 Hz tone. Speed changes are
 * checked on exports: which source moment each frame shows, the file length,
 * and that the tone keeps its pitch (a plain speed-up would move it to 880 Hz).
 */
/** Timestamp masks: the same moment differs by ~0.1%, other moments by ≥ 1% (measured). */
const SAME_MOMENT = 0.4;

test.describe('speed', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video);
    await editor.clickClip(0, 1.5);
  });

  const speed = () => editor.page.getByRole('combobox', { name: 'Speed', exact: true });
  const videoTrack = async () => (await editor.tracks()).find((t) => t.startsWith('Video'))!;

  test('2x halves the clip, shows the media twice as fast and keeps the pitch', async () => {
    await speed().selectOption('200');
    expect(await videoTrack()).toContain('from 00:00:00 to 00:03:00 at 2× speed');

    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    expect(Number(probe(path).format.duration)).toBeCloseTo(3, 0);
    // Each moment of the export shows the source at twice the time.
    const source = fixture(FIXTURES.video);
    for (const seconds of [1, 2.5]) {
      const exported = timestampMask(path, seconds);
      expect(maskDifference(exported, timestampMask(source, seconds * 2))).toBeLessThan(
        SAME_MOMENT,
      );
      expect(maskDifference(exported, timestampMask(source, seconds))).toBeGreaterThan(
        SAME_MOMENT * 2,
      );
    }
  });

  /**
   * steps.wav steps from 440 Hz to 880 Hz at 3 s. At speed S the step moves to
   * 3/S s, and each tone keeps its pitch (a plain resample would shift both).
   * Measured: a playing tone reads -18 dBFS, an absent one -40 dB or lower.
   */
  for (const [percent, step] of [
    ['200', 1.5],
    ['50', 6],
  ] as const) {
    test(`sound at ${Number(percent) / 100}x keeps its pitch and timing`, async () => {
      await editor.press('m'); // mute the video clip's own 440 Hz tone
      await editor.importFixtures(FIXTURES.steps); // on the audio track, 0-6 s
      await editor.clickClip(1, 1);
      await speed().selectOption(percent);
      const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
      const level = (hz: number, from: number, to: number) => toneDb(path, hz, from, to - from);
      const margin = step * 0.15; // keep clear of the step and the file's edges
      expect(level(440, margin, step - margin)).toBeGreaterThan(-24);
      expect(level(880, margin, step - margin)).toBeLessThan(-34);
      expect(level(880, step + margin, 2 * step - margin)).toBeGreaterThan(-24);
      expect(level(440, step + margin, 2 * step - margin)).toBeLessThan(-34);
    });
  }

  test('a sped-up clip plays in real time with sound', async () => {
    await speed().selectOption('200');
    await editor.press('Space');
    await editor.page.waitForTimeout(1500);
    const level = await editor.meterLevel();
    await editor.press('Space');
    // Playback still runs on the audio clock in real time; the clip is just shorter.
    const { playhead } = await editor.times();
    expect(playhead).toBeGreaterThan(1.0);
    expect(playhead).toBeLessThan(2.0);
    expect(level).toBeGreaterThan(0.05);
    expect(await editor.status()).toContain('audio clock');
  });

  test('slowing down needs room after the clip, and undoes and saves', async () => {
    await editor.importFixtures(FIXTURES.video); // appended at 6-12 s
    await editor.clickClip(0, 1.5);
    await speed().selectOption('50');
    await expect(editor.page.getByText(/room for the slower clip/)).toBeVisible();
    expect(await videoTrack()).not.toContain('speed');

    await editor.clickClip(0, 8); // the last clip has room
    await speed().selectOption('50');
    expect(await videoTrack()).toContain('from 00:06:00 to 00:18:00 at 0.5× speed');
    await editor.press('Control+z');
    expect(await videoTrack()).not.toContain('speed');
    await editor.press('Control+Shift+z');
    await editor.waitSaved();
    await editor.reload();
    expect(await videoTrack()).toContain('to 00:18:00 at 0.5× speed');
  });
});
