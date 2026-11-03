import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('makes safe, readable stems', () => {
    expect(slugify('My Holiday Clip.MOV', 'x')).toBe('my-holiday-clip');
    expect(slugify('Café déjà vu', 'x')).toBe('cafe-deja-vu');
    expect(slugify('../../etc/passwd', 'x')).toBe('etcpasswd');
  });

  it('falls back when nothing is left', () => {
    expect(slugify('???', 'fallback')).toBe('fallback');
    expect(slugify('', 'fallback')).toBe('fallback');
  });

  it('caps the length without a trailing dash', () => {
    const slug = slugify('word '.repeat(40), 'x', 12);
    expect(slug.length).toBeLessThanOrEqual(12);
    expect(slug.endsWith('-')).toBe(false);
  });
});
