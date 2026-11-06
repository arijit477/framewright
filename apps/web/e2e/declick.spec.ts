import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { FIXTURES, maxStep } from './media';

/**
 * Hard cuts don't click. music.wav is a 220 Hz tone: trimmed to stop at an
 * arbitrary point, it would end mid-wave, a sudden jump in the waveform that
 * sounds as a click. A 5 ms fade at the cut removes it.
 */
test('a sound cut off mid-wave doesn’t click', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  // tone.webm (6 s, a 440 Hz tone: nothing near the measured band) keeps the export going
  // past the cut, so the cut isn't the end of the file (encoders add artifacts there).
  await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
  await editor.clickClip(0, 1);
  await editor.press('m'); // mute it: its picture only
  // Trim the end from 4 s to 2 s + 22 frames (2.733 s): 601⅓ cycles of 220 Hz, so the tone
  // stops a third of the way through a cycle, well away from zero. (Cuts are on frames:
  // every third frame would end on a whole cycle, and not click anyway.)
  await editor.dragClip(1, 3.98, { toSeconds: 2.735, toRow: 1 });
  const track = (await editor.tracks())[1]!;
  const end = /to 00:02:(\d\d)/.exec(track);
  expect(end, track).not.toBeNull();
  const cut = 2 + Number(end![1]) / 30;
  expect((cut * 220) % 1, `the cut at ${cut} s must not end on a whole cycle`).toBeGreaterThan(0.1);
  const path = await editor.exportTo(test.info().outputDir, { resolution: '480p' });
  const nearCut = maxStep(path, cut - 0.05, 0.1);
  const steady = maxStep(path, 1, 0.5);
  // Measured: about 0.0018 per sample for the tone itself; 0.049 at the cut without fades.
  expect(nearCut, JSON.stringify({ cut, nearCut, steady })).toBeLessThan(steady * 2);
});
