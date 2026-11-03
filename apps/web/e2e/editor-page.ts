import { expect, type Locator, type Page } from '@playwright/test';
import type { ExportFormat, ExportResolution, ExportFps } from '../src/export/settings';
import { RULER_HEIGHT, TRACK_GAP, TRACK_HEIGHT, TRACK_PADDING_X } from '../src/timeline/geometry';
import { fixture } from './media';

/** Default zoom (store/editor.ts: view.pxPerSecond). */
const PX_PER_SECOND = 60;

/**
 * Page object: the only place that knows how the editor UI is laid out.
 * Tests describe behaviour; if the layout changes, only this file changes.
 */
export class EditorPage {
  readonly timeline: Locator;

  constructor(readonly page: Page) {
    this.timeline = page.locator('.timeline canvas');
  }

  async goto() {
    await this.page.goto('/');
    await expect(this.page.getByRole('button', { name: 'Import' })).toBeVisible();
  }

  async importFixtures(...names: string[]) {
    await this.page.setInputFiles('input[type=file]', names.map(fixture));
    await expect(this.page.locator('.preview-empty')).toHaveCount(0, { timeout: 15_000 });
  }

  /** Playhead and total duration in seconds, read from the timecode display. */
  async times(): Promise<{ playhead: number; duration: number }> {
    const text = (await this.page.getByLabel('Playhead time').textContent()) ?? '';
    const [playhead = 0, duration = 0] = text.split('/').map(parseTimecode);
    return { playhead, duration };
  }

  async seekTo(seconds: number) {
    const box = await this.box();
    await this.page.mouse.click(box.x + this.xAt(seconds), box.y + RULER_HEIGHT / 2);
  }

  /** Click inside a clip on track `trackIndex` (0 = video, 1 = audio) at `seconds`. */
  async clickClip(trackIndex: number, seconds: number) {
    const box = await this.box();
    const y = RULER_HEIGHT + TRACK_GAP + trackIndex * (TRACK_HEIGHT + TRACK_GAP) + TRACK_HEIGHT / 2;
    await this.page.mouse.click(box.x + this.xAt(seconds), box.y + y);
  }

  async press(key: string) {
    await this.page.keyboard.press(key);
  }

  async status() {
    return (await this.page.locator('.status').textContent()) ?? '';
  }

  /** Output level meter (left channel), 0..1. */
  async meterLevel(): Promise<number> {
    const transform = await this.page
      .locator('.meter-fill')
      .first()
      .evaluate((el) => (el as HTMLElement).style.transform);
    return Number(/scaleX\(([\d.e-]+)\)/.exec(transform)?.[1] ?? 0);
  }

  async openExport() {
    await this.press('Control+e');
    await expect(this.page.locator('dialog[open] form')).toBeVisible();
  }

  async chooseExportSettings(options: {
    format?: ExportFormat;
    resolution?: ExportResolution;
    fps?: ExportFps;
  }) {
    const dialog = this.page.locator('dialog[open]');
    if (options.format) await dialog.getByLabel('Format').selectOption(options.format);
    if (options.resolution) await dialog.getByLabel('Resolution').selectOption(options.resolution);
    if (options.fps) await dialog.getByLabel('Frame rate').selectOption(String(options.fps));
  }

  /** Export with the given settings and save the file. Returns its path. */
  async exportTo(dir: string, options: Parameters<EditorPage['chooseExportSettings']>[0] = {}) {
    await this.openExport();
    await this.chooseExportSettings(options);
    const dialog = this.page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(dialog.locator('.export-done')).toBeVisible({ timeout: 120_000 });
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      dialog.getByRole('link', { name: 'Download' }).click(),
    ]);
    const path = `${dir}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    await dialog.getByRole('button', { name: 'Close' }).click();
    return path;
  }

  // ------------------------------------------------------------ projects

  /** Wait until autosave (and media copies) have finished. */
  async waitSaved() {
    await expect(this.page.locator('.save-status')).toHaveText('All changes saved', {
      timeout: 20_000,
    });
  }

  async projectName() {
    return ((await this.page.locator('.project-name').textContent()) ?? '').replace(/\s*▾$/, '');
  }

  async openProjects() {
    await this.page.locator('.project-name').click();
    await expect(this.page.locator('dialog[open] #projects-title')).toBeVisible();
    return this.page.locator('dialog[open]');
  }

  async renameProject(name: string) {
    const dialog = await this.openProjects();
    const input = dialog.getByLabel('Project name');
    await input.fill(name);
    await input.press('Enter');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(this.page.locator('.project-name')).toContainText(name);
  }

  async newProject() {
    const dialog = await this.openProjects();
    await dialog.getByRole('button', { name: 'New project' }).click();
    await expect(this.page.locator('dialog[open]')).toHaveCount(0);
  }

  async openProjectNamed(name: string) {
    const dialog = await this.openProjects();
    await dialog.getByRole('button', { name: `Open ${name}` }).click();
    await expect(this.page.locator('.project-name')).toContainText(name);
  }

  async reload() {
    await this.page.reload();
    await expect(this.page.getByRole('button', { name: 'Import' })).toBeVisible({
      timeout: 15_000,
    });
  }

  private xAt(seconds: number) {
    return TRACK_PADDING_X + seconds * PX_PER_SECOND;
  }

  private async box() {
    const box = await this.timeline.boundingBox();
    if (!box) throw new Error('Timeline is not visible');
    return box;
  }
}

/** "MM:SS:FF" or "H:MM:SS:FF" at 30 fps -> seconds. */
function parseTimecode(text: string): number {
  const parts = text.trim().split(':').map(Number);
  const frames = parts.pop() ?? 0;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds + frames / 30;
}
