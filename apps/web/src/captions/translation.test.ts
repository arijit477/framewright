import { describe, expect, it } from 'vitest';
import {
  routeDownloadMb,
  sourceLanguages,
  targetLanguages,
  TRANSLATION_PAIRS,
  translationRoute,
} from './translation';
import { LANGUAGE_NAMES } from './languages';

describe('translation routes', () => {
  it('uses a direct model when there is one', () => {
    expect(translationRoute('en', 'es')).toEqual(['en-es']);
    expect(translationRoute('es', 'fr')).toEqual(['es-fr']);
    expect(translationRoute('hi', 'en')).toEqual(['hi-en']);
  });

  it('goes through English otherwise', () => {
    expect(translationRoute('hi', 'es')).toEqual(['hi-en', 'en-es']);
    expect(translationRoute('ja', 'de')).toEqual(['ja-en', 'en-de']);
  });

  it('has no route to the same language, or without models', () => {
    expect(translationRoute('en', 'en')).toBeNull();
    expect(translationRoute('en', 'ja')).toBeNull(); // no English -> Japanese model offered
    expect(translationRoute('xx', 'en')).toBeNull();
  });

  it('adds up the download along a route', () => {
    const [a, b] = ['hi-en', 'en-es'];
    expect(routeDownloadMb([a, b])).toBe(
      TRANSLATION_PAIRS[a]!.downloadMb + TRANSLATION_PAIRS[b]!.downloadMb,
    );
  });

  it('offers only languages with a route, all with names', () => {
    for (const from of sourceLanguages()) {
      expect(LANGUAGE_NAMES[from], from).toBeDefined();
      const targets = targetLanguages(from);
      expect(targets.length, from).toBeGreaterThan(0);
      for (const to of targets) {
        expect(LANGUAGE_NAMES[to], to).toBeDefined();
        expect(translationRoute(from, to), `${from}-${to}`).not.toBeNull();
      }
    }
    expect(sourceLanguages()[0]).toBe('en');
    expect(targetLanguages('hi')).toContain('es');
    expect(targetLanguages('en')).not.toContain('en');
  });

  it('pins every model', () => {
    for (const [pair, { revision, downloadMb }] of Object.entries(TRANSLATION_PAIRS)) {
      expect(revision, pair).toMatch(/^[0-9a-f]{40}$/);
      expect(downloadMb, pair).toBeGreaterThan(50);
    }
  });
});
