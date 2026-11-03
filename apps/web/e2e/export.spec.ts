import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { countFrames, decodeErrors, FIXTURES, peakDb, probe } from './media';

/**
 * Exports are checked with ffprobe/ffmpeg, independently of the app:
 * codecs, dimensions, exact frame count, clean decode, and audio level.
 */
test.describe('export', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video, FIXTURES.audio);
  });

  test('MP4: frame-accurate H.264 with the mixed audio', async () => {
    const path = await editor.exportTo(test.info().outputDir, {
      format: 'mp4',
      resolution: '1080p',
      fps: 30,
    });
    const { streams } = probe(path);
    const video = streams.find((s) => s.codec_type === 'video');
    expect(video).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
    expect(streams.some((s) => s.codec_type === 'audio')).toBe(true);
    expect(countFrames(path)).toBe(180); // 6 s × 30 fps
    expect(decodeErrors(path)).toBe('');
    // Tone (-18 dBFS) + WAV (-27 dBFS) summed ≈ -15.3 dBFS.
    expect(peakDb(path)).toBeGreaterThan(-16.5);
    expect(peakDb(path)).toBeLessThan(-14);
  });

  test('WebM: muted clips are left out of the mix', async () => {
    await editor.clickClip(1, 2); // the WAV on the audio track
    await editor.press('m');
    const path = await editor.exportTo(test.info().outputDir, {
      format: 'webm',
      resolution: '720p',
      fps: 25,
    });
    const video = probe(path).streams.find((s) => s.codec_type === 'video');
    expect(video).toMatchObject({ codec_name: 'vp9', width: 1280, height: 720 });
    expect(countFrames(path)).toBe(150); // 6 s × 25 fps
    // Only the tone remains (≈ -18 dBFS).
    expect(peakDb(path)).toBeGreaterThan(-19);
    expect(peakDb(path)).toBeLessThan(-16.5);
  });

  test('an export can be cancelled', async () => {
    await editor.openExport();
    await editor.chooseExportSettings({ resolution: '2160p' });
    const dialog = editor.page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(dialog.getByText(/frames/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Cancel export' }).click();
    await expect(dialog.getByText('Export cancelled.')).toBeVisible({ timeout: 20_000 });
    // The editor is usable again: a new export can start.
    await expect(dialog.getByRole('button', { name: 'Export' })).toBeEnabled();
  });
});
