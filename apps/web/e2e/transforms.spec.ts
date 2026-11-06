import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { averageRgb, fixture, FIXTURES, frameRgb } from './media';

/**
 * Transforms are checked on exported 1280×720 files: regions of a frame are
 * averaged and compared with the solid red overlay and the test pattern below.
 */
const region = (x: number, y: number, w: number, h: number) => ({
  crop: `${w}:${h}:${x}:${y}`,
  width: 16,
  height: 8,
});
const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 60 && b < 60;

test.describe('transforms', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.video); // test pattern, 0-6 s
    await editor.importFixtures(FIXTURES.overlay); // red, appended at 6-9 s
    await editor.dragClip(0, 7.5, { toSeconds: 1.5, toRow: 'new-top' }); // red on top, 0-3 s
    await editor.clickClip(0, 1.5); // select it
    await expect(editor.page.getByRole('region', { name: 'Transform' })).toBeVisible();
  });

  const exportAt = async (seconds: number, crop: ReturnType<typeof region>) => {
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    return averageRgb(frameRgb(path, seconds, crop));
  };

  test('picture in picture puts the clip in the corner over the footage', async () => {
    await editor.page.getByRole('button', { name: 'Picture in picture, bottom right' }).click();
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    // PiP: 35% size centred at 78.5% → covers about x 781-1229, y 439-691.
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(905, 515, 200, 100))))).toBe(true);
    // The rest of the frame shows the footage underneath.
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(540, 200, 200, 100))))).toBe(false);
  });

  test('opacity blends the clip with the layer below', async () => {
    await editor.setSlider('Opacity', 50);
    // Over the pattern's blue bar (measured: x 640-853, ≈ 0,0,255), 50% red ≈ 128,0,128.
    const blueBar = region(686, 40, 120, 120);
    const [r, g, b] = await exportAt(1.5, blueBar);
    const [, , sourceBlue] = averageRgb(frameRgb(fixture(FIXTURES.video), 1.5, blueBar));
    expect(sourceBlue).toBeGreaterThan(200); // the region really is the blue bar
    expect(r).toBeGreaterThan(90);
    expect(r).toBeLessThan(170);
    expect(b).toBeGreaterThan(90);
    expect(b).toBeLessThan(170);
    expect(g).toBeLessThan(40);
  });

  test('rotation turns the clip, uncovering the frame edges', async () => {
    await editor.setSlider('Rotation', 90);
    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    // Upright, the red clip fills the frame; turned 90° it is 720 wide, centred.
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(560, 300, 160, 120))))).toBe(true);
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(1100, 300, 160, 120))))).toBe(false);
  });

  test('dragging on the preview moves the clip in one undo step; Escape cancels', async () => {
    await editor.page.getByRole('button', { name: 'Picture in picture, bottom right' }).click();
    expect(await editor.sliderValue('Position X')).toBe(78.5);

    await editor.dragOnPreview([0.78, 0.78], [0.5, 0.5]);
    expect(await editor.sliderValue('Position X')).toBeCloseTo(50.5, 0);
    expect(await editor.sliderValue('Position Y')).toBeCloseTo(50.5, 0);

    await editor.press('Control+z'); // the whole drag is one step
    expect(await editor.sliderValue('Position X')).toBe(78.5);

    await editor.dragOnPreview([0.78, 0.78], [0.2, 0.2], { cancel: true });
    expect(await editor.sliderValue('Position X')).toBe(78.5);
  });

  /** Drag a preview handle to a point given in fractions of the preview. */
  const dragHandle = async (
    name: string,
    to: [number, number],
    { shift = false, cancel = false } = {},
  ) => {
    const handle = await editor.page.getByLabel(name, { exact: true }).boundingBox();
    const frame = await editor.page.locator('.preview-frame canvas').boundingBox();
    if (!handle || !frame) throw new Error('Handle or preview is not visible');
    const mouse = editor.page.mouse;
    await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await mouse.down();
    if (shift) await editor.page.keyboard.down('Shift');
    await mouse.move(frame.x + frame.width * to[0], frame.y + frame.height * to[1], { steps: 8 });
    if (cancel) await editor.press('Escape');
    await mouse.up();
    if (shift) await editor.page.keyboard.up('Shift');
  };

  test('a corner handle resizes the clip about its centre, in one undo step', async () => {
    // The red clip fills the frame: halving the corner's distance from the centre halves it.
    await dragHandle('Resize from the bottom right corner', [0.75, 0.75]);
    const scale = await editor.sliderValue('Scale');
    expect(scale).toBeGreaterThanOrEqual(48); // the pointer lands on whole pixels
    expect(scale).toBeLessThanOrEqual(52);
    expect(await editor.sliderValue('Position X')).toBe(50); // still centred

    const path = await editor.exportTo(test.info().outputDir, { resolution: '720p', fps: 30 });
    // Half size, centred: covers x 320-960, y 180-540.
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(560, 300, 160, 120))))).toBe(true);
    // The pattern shows in the corner (cyan there; its top left is red, so not that one).
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(1080, 580, 160, 100))))).toBe(false);

    await editor.press('Control+z');
    expect(await editor.sliderValue('Scale')).toBe(100);
    await dragHandle('Resize from the top left corner', [0.1, 0.1], { cancel: true });
    expect(await editor.sliderValue('Scale')).toBe(100);
  });

  test('the round handle rotates the clip; Shift snaps to 15°', async () => {
    // A full-frame clip's rotate handle sits just inside its top edge. Dragging it
    // from straight above the centre to straight right of it is a quarter turn.
    await dragHandle('Rotate', [0.8, 0.5]);
    expect(await editor.sliderValue('Rotation')).toBe(90);

    await editor.press('Control+z');
    expect(await editor.sliderValue('Rotation')).toBe(0);
    // Up and a little left of straight right: about 84° unsnapped, 90° snapped.
    await dragHandle('Rotate', [0.8, 0.45], { shift: true });
    expect(await editor.sliderValue('Rotation')).toBe(90);
  });

  test('no handles for a title, or when the selected clip is off screen', async () => {
    await expect(editor.page.getByLabel('Rotate', { exact: true })).toBeVisible();
    await editor.seekTo(4); // the red clip ends at 3 s
    await expect(editor.page.getByLabel('Rotate', { exact: true })).toHaveCount(0);
    await editor.addTitle('Hello'); // selects the new title
    await expect(editor.page.getByLabel('Rotate', { exact: true })).toHaveCount(0);
  });

  test('reset restores the original placement', async () => {
    await editor.page.getByRole('button', { name: 'Picture in picture, top left' }).click();
    await editor.page.getByRole('button', { name: 'Reset transform' }).click();
    expect(await editor.sliderValue('Scale')).toBe(100);
    expect(await editor.sliderValue('Position X')).toBe(50);
    await expect(editor.page.getByRole('button', { name: 'Reset transform' })).toBeDisabled();
  });

  test('Ctrl+E right after moving a slider exports the latest value', async () => {
    const slider = editor.page.getByRole('slider', { name: 'Opacity', exact: true });
    await slider.focus();
    await slider.press('Home'); // opacity 0: the red clip disappears
    await slider.press('Control+e'); // still focused, within the commit delay
    const dialog = editor.page.locator('dialog[open]');
    await dialog.getByLabel('Resolution').selectOption('720p');
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(dialog.locator('.export-done')).toBeVisible({ timeout: 120_000 });
    const [download] = await Promise.all([
      editor.page.waitForEvent('download'),
      dialog.getByRole('link', { name: 'Download' }).click(),
    ]);
    const path = `${test.info().outputDir}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    // With opacity 0 the frame centre shows the pattern, not red.
    expect(isRed(averageRgb(frameRgb(path, 1.5, region(560, 300, 160, 120))))).toBe(false);
  });
});
