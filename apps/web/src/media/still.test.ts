import { describe, expect, it } from 'vitest';
import { isStillFile } from './still';

describe('isStillFile', () => {
  const file = (name: string, type: string) => new File([new Uint8Array(1)], name, { type });

  it('recognises images by type or extension', () => {
    expect(isStillFile(file('logo.png', 'image/png'))).toBe(true);
    expect(isStillFile(file('photo.JPG', ''))).toBe(true); // no type: the extension decides
    expect(isStillFile(file('x.webp', 'image/webp'))).toBe(true);
    expect(isStillFile(file('a.avif', 'image/avif'))).toBe(true);
  });

  it('leaves video, audio and other files alone', () => {
    expect(isStillFile(file('clip.mp4', 'video/mp4'))).toBe(false);
    expect(isStillFile(file('song.mp3', 'audio/mpeg'))).toBe(false);
    expect(isStillFile(file('vector.svg', 'image/svg+xml'))).toBe(false); // needs a size to rasterise
    expect(isStillFile(file('notes.txt', 'text/plain'))).toBe(false);
  });
});
