import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { fixture } from './media';

/**
 * Serve Hugging Face downloads (the Whisper model files) from a disk cache,
 * filling it from the real site on first use. Every test starts with an empty
 * browser cache, so without this each test would download the model again;
 * CI caches the folder between runs. The app still makes real requests: only
 * where the bytes come from changes.
 */
const run = promisify(execFile);

/** The app is cross-origin isolated: cross-origin responses need CORS. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-length, content-range',
  'cross-origin-resource-policy': 'cross-origin',
};

export async function cacheHuggingFace(context: BrowserContext): Promise<void> {
  const dir = fixture('hf-cache');
  mkdirSync(dir, { recursive: true });
  await context.route(/^https:\/\/huggingface\.co\//, async (route) => {
    const url = route.request().url();
    const key = createHash('sha256').update(url).digest('hex');
    // Transformers.js asks for one byte of each file to learn its size (for
    // progress). Answer those with one byte too, like the real site does.
    if ((await route.request().headerValue('range')) === 'bytes=0-0') {
      const sizeFile = join(dir, `${key}.size`);
      if (!existsSync(sizeFile)) {
        try {
          const { stdout } = await run('curl', [
            '-sSL',
            '-r',
            '0-0',
            '-D',
            '-',
            '-o',
            '/dev/null',
            url,
          ]);
          const total = [...stdout.matchAll(/content-range: bytes 0-0\/(\d+)/gi)].at(-1)?.[1];
          if (!total) throw new Error('no size');
          writeFileSync(sizeFile, total);
        } catch {
          await route.fulfill({ status: 404, body: 'Not found', headers: CORS });
          return;
        }
      }
      const total = readFileSync(sizeFile, 'utf8');
      await route.fulfill({
        status: 206,
        body: Buffer.alloc(1),
        headers: { 'content-range': `bytes 0-0/${total}`, ...CORS },
      });
      return;
    }
    const body = join(dir, key);
    const meta = `${body}.json`;
    if (!existsSync(body)) {
      // curl follows the redirect to the CDN and honours HTTPS_PROXY where one is needed.
      try {
        const { stdout } = await run('curl', [
          '-fsSL',
          '--retry',
          '3',
          '-o',
          body,
          '-w',
          '%{content_type}',
          url,
        ]);
        writeFileSync(meta, JSON.stringify({ url, contentType: stdout.trim() || undefined }));
      } catch {
        await route.fulfill({ status: 404, body: 'Not found', headers: CORS });
        return;
      }
    }
    const { contentType } = JSON.parse(readFileSync(meta, 'utf8')) as { contentType?: string };
    await route.fulfill({
      status: 200,
      body: readFileSync(body),
      headers: { 'content-type': contentType ?? 'application/octet-stream', ...CORS },
    });
  });
}
