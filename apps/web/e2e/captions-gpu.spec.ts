import { expect, test } from '@playwright/test';
import { EditorPage } from './editor-page';
import { cacheHuggingFace } from './hf-cache';
import { FIXTURES } from './media';

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * With WebGPU on (Chromium's software adapter in headless runs, so this checks
 * that it works, not how fast), the encoder runs on the graphics card.
 */
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu'],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  },
});

test.describe('auto captions on the graphics card', () => {
  let editor: EditorPage;
  let models: string[];

  test.beforeEach(async ({ page, context }) => {
    await cacheHuggingFace(context);
    models = [];
    page.on('request', (r) => {
      const file = /\/resolve\/[0-9a-f]{40}\/onnx\/(.+\.onnx)$/.exec(r.url())?.[1];
      if (file && !models.includes(file)) models.push(file);
    });
    editor = new EditorPage(page);
    await editor.goto();
    await editor.importFixtures(FIXTURES.speech);
    await page.getByRole('button', { name: 'Captions' }).click();
  });

  const dialog = () => editor.page.getByRole('dialog', { name: 'Auto captions' });
  const FELL_BACK = /graphics card couldn’t run the speech model, so the processor was used/;
  const start = async () => {
    await dialog().getByLabel(/^Fast/).check();
    await dialog().getByLabel('Language').selectOption('en');
    await dialog().getByRole('button', { name: 'Create captions' }).click();
  };
  const run = async () => {
    await start();
    await expect(dialog()).toBeHidden({ timeout: 280_000 });
  };
  const heard = async () =>
    words(
      ((await editor.tracks())[0] ?? '').replace(/ from \d\d:\d\d:\d\d to \d\d:\d\d:\d\d/g, ''),
    );

  test('recognises speech with the encoder on the graphics card', async () => {
    test.setTimeout(300_000);
    const gpu = dialog().getByLabel(/Use the graphics card/);
    await expect(gpu).toBeChecked();
    await expect(dialog().getByLabel(/^Fast/).locator('..')).toContainText('about 64 MB');
    await run();
    expect(await heard()).toEqual(
      expect.arrayContaining(['ask', 'not', 'what', 'your', 'country']),
    );
    // Full-precision encoder (GPU), 8-bit decoder (processor); no fallback.
    expect(models.sort()).toEqual(['decoder_model_merged_quantized.onnx', 'encoder_model.onnx']);
    await expect(editor.page.getByText(/^Added \d+ captions? on a new track\.$/)).toBeVisible();
  });

  test('falls back to the processor when the graphics card fails', async () => {
    test.setTimeout(300_000);
    // A damaged GPU model file stands in for any GPU failure.
    await editor.page.route(/\/onnx\/encoder_model\.onnx$/, (route) =>
      route.fulfill({
        status: 200,
        body: 'not a model',
        headers: {
          'access-control-allow-origin': '*',
          'cross-origin-resource-policy': 'cross-origin',
        },
      }),
    );
    await start();
    // Said while it runs, and again when it's done.
    await expect(dialog().getByText(FELL_BACK)).toBeVisible({ timeout: 60_000 });
    await expect(dialog()).toBeHidden({ timeout: 280_000 });
    await expect(editor.page.getByText(/^Added \d+ captions? on a new track\./)).toContainText(
      FELL_BACK,
    );
    expect(await heard()).toEqual(
      expect.arrayContaining(['ask', 'not', 'what', 'your', 'country']),
    );
    expect(models).toContain('encoder_model_quantized.onnx');
  });

  test('the graphics card can be turned off, and that is remembered', async () => {
    test.setTimeout(300_000);
    await dialog()
      .getByLabel(/Use the graphics card/)
      .uncheck();
    await expect(dialog().getByLabel(/^Fast/).locator('..')).toContainText('about 41 MB');
    await run();
    expect(models.sort()).toEqual([
      'decoder_model_merged_quantized.onnx',
      'encoder_model_quantized.onnx',
    ]);
    await editor.reload();
    await editor.page.getByRole('button', { name: 'Captions' }).click();
    await expect(dialog().getByLabel(/Use the graphics card/)).not.toBeChecked();
  });
});
