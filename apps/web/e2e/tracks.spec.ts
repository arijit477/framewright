import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, fixture, FIXTURES, frameDifference, frameRgb } from './media';

/**
 * Multiple video tracks. Layering is checked on exported files with ffmpeg,
 * so the tests verify what the user actually gets, not just the UI.
 */
test.describe('multiple video tracks', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
  });

  test('dragging a clip above the top track creates a layer that covers the one below', async () => {
    await editor.importFixtures(FIXTURES.video); // 0-6 s
    await editor.importFixtures(FIXTURES.overlay); // red, appended at 6-9 s
    await editor.dragClip(0, 7.5, { toSeconds: 3.5, toRow: 'new-top' }); // red now 2-5 s

    expect(await editor.tracks()).toEqual([
      'Video 2: red.webm from 00:02:00 to 00:05:00',
      'Video 1: tone.webm from 00:00:00 to 00:06:00',
      'Audio 1: empty',
    ]);

    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    const [r, g, b] = averageRgb(frameRgb(path, 3));
    expect(r).toBeGreaterThan(200); // the red layer is on top...
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
    const [, g2] = averageRgb(frameRgb(path, 5.5));
    expect(g2).toBeGreaterThan(60); // ...and the test pattern shows once it ends
  });

  test('undo restores the previous layout in one step', async () => {
    await editor.importFixtures(FIXTURES.video);
    await editor.importFixtures(FIXTURES.overlay);
    await editor.dragClip(0, 7.5, { toSeconds: 3.5, toRow: 'new-top' });
    expect(await editor.tracks()).toHaveLength(3);
    await editor.press('Control+z');
    expect(await editor.tracks()).toEqual([
      'Video 1: tone.webm from 00:00:00 to 00:06:00; red.webm from 00:06:00 to 00:09:00',
      'Audio 1: empty',
    ]);
  });

  test('a track emptied by moving its last clip is removed', async () => {
    await editor.importFixtures(FIXTURES.video);
    await editor.importFixtures(FIXTURES.overlay);
    await editor.dragClip(0, 7.5, { toSeconds: 3.5, toRow: 'new-top' }); // red on Video 2
    await editor.dragClip(0, 3.5, { toSeconds: 7.5, toRow: 1 }); // back down onto Video 1
    expect(await editor.tracks()).toEqual([
      'Video 1: tone.webm from 00:00:00 to 00:06:00; red.webm from 00:06:00 to 00:09:00',
      'Audio 1: empty',
    ]);
  });

  test('the same file on two tracks at once shows the right frames', async () => {
    await editor.importFixtures(FIXTURES.video); // tone 0-6 s
    await editor.seekTo(3);
    await editor.press('s'); // split: 0-3 and 3-6 (source 3-6)
    await editor.dragClip(0, 4.5, { toSeconds: 2.5, toRow: 'new-top' }); // second half to 1-4 s on top
    expect(await editor.tracks()).toEqual([
      'Video 2: tone.webm from 00:01:00 to 00:04:00',
      'Video 1: tone.webm from 00:00:00 to 00:03:00',
      'Audio 1: empty',
    ]);

    // At 2 s the top layer shows source time 4 s (3 s + 1 s into the clip), not 2 s.
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    // The burned-in timecode and frame counter (top-left) differ clearly between frames.
    const region = { crop: '200:60:0:0', width: 100, height: 30 };
    const exported = frameRgb(path, 2.0, region);
    const source = fixture(FIXTURES.video);
    const expected = frameDifference(exported, frameRgb(source, 4.0, region));
    const wrong = frameDifference(exported, frameRgb(source, 2.0, region));
    expect(expected).toBeLessThan(wrong / 2);
  });
});
