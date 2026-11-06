import { describe, expect, it, vi } from 'vitest';
import type { FontFamily } from '../engine/types';
import { FONT_FILES } from './font-files';
import { FONT_STACKS, filesFor, FontLoader, parseUnicodeRange, type FontFile } from './fonts';

const file = (family: FontFamily, style: string, unicodeRange: string, url: string): FontFile => ({
  family,
  style,
  weight: '100 900',
  unicodeRange,
  url,
});
const FILES = [
  file('sans', 'normal', 'U+0000-00FF,U+0131', 'latin'),
  file('sans', 'normal', 'U+0400-045F', 'cyrillic'),
  file('sans', 'italic', 'U+0000-00FF', 'latin-italic'),
  file('display', 'normal', 'U+0000-00FF', 'display-latin'),
];

describe('parseUnicodeRange', () => {
  it('reads single code points and ranges', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+0131,U+1E00-1E9F')).toEqual([
      [0, 255],
      [0x131, 0x131],
      [0x1e00, 0x1e9f],
    ]);
  });
});

describe('filesFor', () => {
  const urls = (files: FontFile[]) => files.map((f) => f.url);

  it('picks only the files covering the characters', () => {
    expect(urls(filesFor(FILES, 'sans', false, 'Hello'))).toEqual(['latin']);
    expect(urls(filesFor(FILES, 'sans', false, 'Hi Привет'))).toEqual(['latin', 'cyrillic']);
    expect(urls(filesFor(FILES, 'sans', false, '你好'))).toEqual([]); // system fallback
  });

  it('uses the italic files, or the upright ones if the family has none', () => {
    expect(urls(filesFor(FILES, 'sans', true, 'Hello'))).toEqual(['latin-italic']);
    expect(urls(filesFor(FILES, 'display', true, 'Hello'))).toEqual(['display-latin']);
  });
});

describe('FontLoader', () => {
  const setup = (fail = false) => {
    const added: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const loader = new FontLoader(
      { add: (face) => added.push((face as unknown as { url: string }).url) },
      FILES,
      (f) =>
        ({
          url: f.url,
          load: vi.fn(async () => {
            await gate;
            if (fail) throw new Error('404');
          }),
        }) as unknown as FontFace,
    );
    return { loader, added, release };
  };

  it('loads each needed file once and is then ready at once', async () => {
    const { loader, added, release } = setup();
    const runs = [{ family: 'sans' as const, italic: false, text: 'Hi' }];
    const first = loader.ready(runs);
    const second = loader.ready([...runs, { family: 'sans', italic: false, text: 'Ok' }]);
    expect(first).not.toBeNull();
    expect(added).toEqual(['latin']); // not twice
    release();
    await Promise.all([first, second]);
    expect(loader.ready(runs)).toBeNull();
    // New characters need another file.
    expect(loader.ready([{ family: 'sans', italic: false, text: 'Да' }])).not.toBeNull();
    expect(added).toEqual(['latin', 'cyrillic']);
  });

  it('tolerates a file that fails to load: text falls back to system fonts', async () => {
    const { loader, release } = setup(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runs = [{ family: 'display' as const, italic: false, text: 'Hi' }];
    const ready = loader.ready(runs);
    release();
    await expect(ready).resolves.toBeUndefined();
    expect(loader.ready(runs)).toBeNull(); // not retried every frame
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('bundled fonts', () => {
  const families: FontFamily[] = ['sans', 'serif', 'mono', 'handwriting', 'display'];

  it('cover basic Latin in every family, upright and (where offered) italic', () => {
    for (const family of families) {
      expect(filesFor(FONT_FILES, family, false, 'Az09')).toHaveLength(1);
      expect(filesFor(FONT_FILES, family, true, 'Az09')).toHaveLength(1);
    }
  });

  it('put the bundled face first in each stack, with a generic fallback last', () => {
    for (const family of families) {
      expect(FONT_STACKS[family]).toMatch(/^"Framewright /);
      expect(FONT_STACKS[family]).toMatch(/(sans-serif|serif|monospace|cursive)$/);
    }
  });
});
