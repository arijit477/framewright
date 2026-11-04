import { writeFileSync } from 'node:fs';
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

  /**
   * Open the editor. Playwright can't operate the native Save dialog, so
   * `savePicker` replaces it: 'none' removes it (exports go to browser storage
   * and are downloaded), 'fake' returns a real writable file in browser storage
   * (exercising the stream-to-a-picked-file path), 'cancel' simulates the user
   * dismissing the dialog.
   */
  async goto({ savePicker = 'none' }: { savePicker?: 'none' | 'fake' | 'cancel' } = {}) {
    await this.page.addInitScript((mode) => {
      const w = window as { showSaveFilePicker?: unknown };
      if (mode === 'none') delete w.showSaveFilePicker;
      if (mode === 'cancel') {
        w.showSaveFilePicker = () => Promise.reject(new DOMException('cancelled', 'AbortError'));
      }
      if (mode === 'fake') {
        w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle('picked', { create: true });
          return dir.getFileHandle(suggestedName, { create: true });
        };
      }
    }, savePicker);
    await this.page.goto('/');
    await expect(this.page.getByRole('button', { name: 'Import' })).toBeVisible();
  }

  /**
   * Import files and wait until every one of them is on the timeline. (Waiting
   * for the empty-preview message to go isn't enough: after the first import it
   * is already gone, so later imports would return before they finished.)
   */
  async importFixtures(...names: string[]) {
    await this.page.setInputFiles('input[type=file]', names.map(fixture));
    const tracks = this.page.getByRole('list', { name: 'Timeline tracks' });
    for (const name of names) await expect(tracks).toContainText(name, { timeout: 15_000 });
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

  /** The accessible track list, top row first, e.g. "Video 2: red.webm from 00:02:00 to 00:05:00". */
  async tracks(): Promise<string[]> {
    return this.page
      .getByRole('list', { name: 'Timeline tracks' })
      .getByRole('listitem')
      .allInnerTexts();
  }

  /**
   * Drag the clip on display row `row` grabbed at `seconds` so that point lands
   * at `toSeconds`, either on display row `toRow` or into a new top video track.
   */
  async dragClip(
    row: number,
    seconds: number,
    to: { toSeconds: number; toRow: number | 'new-top' },
  ) {
    const box = await this.box();
    const rowY = (r: number) =>
      RULER_HEIGHT + TRACK_GAP + r * (TRACK_HEIGHT + TRACK_GAP) + TRACK_HEIGHT / 2;
    const targetY = to.toRow === 'new-top' ? RULER_HEIGHT / 2 : rowY(to.toRow);
    await this.page.mouse.move(box.x + this.xAt(seconds), box.y + rowY(row));
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + this.xAt(to.toSeconds), box.y + targetY, { steps: 6 });
    await this.page.mouse.up();
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

  /**
   * Number of distinct colours drawn across a clip's middle row on the
   * timeline canvas, between two times. A plain clip has very few; a filmstrip
   * of the test pattern has many. Reads the actual pixels, so it checks what
   * the user sees.
   */
  async clipColors(trackIndex: number, fromSeconds: number, toSeconds: number): Promise<number> {
    const y =
      RULER_HEIGHT + TRACK_GAP + trackIndex * (TRACK_HEIGHT + TRACK_GAP) + TRACK_HEIGHT * 0.45;
    return this.timeline.evaluate(
      (canvas, { x0, x1, y }) => {
        const c = canvas as HTMLCanvasElement;
        const scale = c.width / c.clientWidth;
        const ctx = c.getContext('2d')!;
        const row = ctx.getImageData(
          Math.round(x0 * scale),
          Math.round(y * scale),
          Math.round((x1 - x0) * scale),
          1,
        ).data;
        const colours = new Set<number>();
        // Quantize to 4 bits per channel so anti-aliasing doesn't inflate the count.
        for (let i = 0; i < row.length; i += 4) {
          colours.add(((row[i]! >> 4) << 8) | ((row[i + 1]! >> 4) << 4) | (row[i + 2]! >> 4));
        }
        return colours.size;
      },
      { x0: this.xAt(fromSeconds), x1: this.xAt(toSeconds), y },
    );
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

  /** Names of files in a folder of browser storage (OPFS); empty if it doesn't exist. */
  async storedFiles(folder: string): Promise<string[]> {
    return this.page.evaluate(async (name) => {
      const root = await navigator.storage.getDirectory();
      try {
        const dir = await root.getDirectoryHandle(name);
        const names: string[] = [];
        for await (const [entry] of dir.entries()) names.push(entry);
        return names;
      } catch {
        return [];
      }
    }, folder);
  }

  /** Copy a file out of browser storage (OPFS) to `path` on disk. */
  async saveStoredFile(folder: string, name: string, path: string) {
    const base64 = await this.page.evaluate(
      async ({ folder, name }) => {
        const root = await navigator.storage.getDirectory();
        const file = await (
          await (await root.getDirectoryHandle(folder)).getFileHandle(name)
        ).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      },
      { folder, name },
    );
    writeFileSync(path, Buffer.from(base64, 'base64'));
  }

  /** Download the current project's backup into `dir`; returns the file path. */
  async downloadBackup(dir: string) {
    const dialog = await this.openProjects();
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Download backup' }).click(),
    ]);
    const path = `${dir}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    await dialog.getByRole('button', { name: 'Close' }).click();
    return path;
  }

  async importBackup(path: string) {
    const dialog = await this.openProjects();
    await dialog.getByLabel('Choose a backup file').setInputFiles(path);
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
