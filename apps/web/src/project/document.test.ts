import { describe, expect, it } from 'vitest';
import {
  cleanName,
  createProject,
  DEFAULT_PROJECT_NAME,
  matchFile,
  parseProject,
  PROJECT_VERSION,
  ProjectFormatError,
  serializeProject,
  summarize,
  uniqueName,
  type ProjectAsset,
  type ProjectDocument,
} from './document';
import { encodeLut, makeLut } from '../render/lut';

const NOW = new Date('2026-11-03T12:00:00.000Z');

const asset: ProjectAsset = {
  id: 'a1',
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 1234,
  lastModified: 1_700_000_000_000,
  durationUs: 6_000_000,
  width: 1920,
  height: 1080,
  codec: 'avc',
  hasVideo: true,
  hasAudio: true,
};

const project = (patch: Partial<ProjectDocument> = {}): ProjectDocument => ({
  ...createProject('p1', NOW),
  timeline: { tracks: [{ id: 1, kind: 'video', clips: [{ id: 2 }, { id: 3 }] }], nextId: 3 },
  assets: [asset],
  durationUs: 6_000_000,
  ...patch,
});

const reject = (text: string, message: RegExp) => {
  expect(() => parseProject(text)).toThrow(ProjectFormatError);
  expect(() => parseProject(text)).toThrow(message);
};

describe('project documents', () => {
  it('round-trips through serialize/parse', () => {
    const doc = project();
    expect(parseProject(serializeProject(doc))).toEqual(doc);
  });

  it('keeps the still-image flag, and only when set', () => {
    const photo: ProjectAsset = {
      ...asset,
      id: 'a2',
      name: 'photo.png',
      type: 'image/png',
      still: true,
    };
    const doc = parseProject(serializeProject(project({ assets: [asset, photo] })));
    expect(doc.assets[1]!.still).toBe(true);
    expect('still' in doc.assets[0]!).toBe(false); // older and video assets are unchanged
  });

  it('creates an empty project', () => {
    const doc = createProject('p9', NOW);
    expect(doc).toMatchObject({ id: 'p9', name: DEFAULT_PROJECT_NAME, timeline: null, assets: [] });
    expect(doc.createdAt).toBe('2026-11-03T12:00:00.000Z');
  });

  it('rejects damaged or foreign files with a clear message', () => {
    reject('{ not json', /not valid JSON/);
    reject('{"hello": 1}', /not a Framewright project/);
    reject('[]', /not a Framewright project/);
    reject(JSON.stringify({ ...project(), version: 'one' }), /no valid version/);
  });

  it('refuses projects from a newer app instead of corrupting them', () => {
    reject(JSON.stringify({ ...project(), version: PROJECT_VERSION + 1 }), /newer version/);
  });

  it('validates fields and media entries', () => {
    reject(JSON.stringify({ ...project(), id: '' }), /invalid "id"/);
    reject(JSON.stringify({ ...project(), updatedAt: 'yesterday' }), /invalid "updatedAt"/);
    reject(JSON.stringify({ ...project(), timeline: 'tracks' }), /invalid "timeline"/);
    reject(JSON.stringify({ ...project(), assets: [{ ...asset, size: -1 }] }), /Media entry 1/);
    reject(JSON.stringify({ ...project(), assets: [asset, asset] }), /twice/);
  });

  it('summarizes for the project list', () => {
    expect(summarize(project())).toEqual({
      id: 'p1',
      name: DEFAULT_PROJECT_NAME,
      updatedAt: NOW.toISOString(),
      durationUs: 6_000_000,
      clipCount: 2,
    });
    expect(summarize(createProject('p2', NOW)).clipCount).toBe(0);
  });
});

describe('cleanName', () => {
  it('normalizes whitespace, caps length and never returns empty', () => {
    expect(cleanName('  My   trip \n video ')).toBe('My trip video');
    expect(cleanName('   ')).toBe(DEFAULT_PROJECT_NAME);
    expect(cleanName('x'.repeat(500))).toHaveLength(100);
  });
});

describe('matchFile', () => {
  const files = [
    { name: 'CLIP.mp4', size: 99 },
    { name: 'clip.mp4', size: 1234 },
    { name: 'other.mp4', size: 1234 },
  ];

  it('prefers same name and size, then same name', () => {
    expect(matchFile(asset, files)).toBe(files[1]);
    expect(matchFile({ name: 'clip.mp4', size: 1 }, files)).toBe(files[0]);
  });

  it('returns null when nothing matches by name', () => {
    expect(matchFile({ name: 'missing.mov', size: 1234 }, files)).toBeNull();
  });
});

describe('uniqueName', () => {
  it('keeps free names and numbers taken ones', () => {
    expect(uniqueName('Trip', ['Other'])).toBe('Trip');
    expect(uniqueName('Trip', ['trip'])).toBe('Trip (2)');
    expect(uniqueName('Trip', ['Trip', 'Trip (2)'])).toBe('Trip (3)');
  });

  it('stays within the length limit', () => {
    const long = 'x'.repeat(100);
    expect(uniqueName(long, [long])).toHaveLength(100);
  });
});

describe('LUTs (version 2)', () => {
  const lut = { id: 'l1', name: 'Teal', size: 2, data: encodeLut(makeLut(2)) };

  it('round-trips LUTs', () => {
    const doc = project({ luts: [lut] });
    expect(parseProject(serializeProject(doc)).luts).toEqual([lut]);
  });

  it('migrates version 1 projects, which had no LUTs', () => {
    const { luts: _luts, ...v1 } = { ...project(), version: 1 };
    const migrated = parseProject(JSON.stringify(v1));
    expect(migrated.version).toBe(PROJECT_VERSION);
    expect(migrated.luts).toEqual([]);
    expect(migrated.assets).toEqual([asset]);
  });

  it('rejects damaged or duplicate LUTs', () => {
    const bad = (luts: unknown[]) => () => parseProject(JSON.stringify({ ...project(), luts }));
    expect(bad([{ ...lut, size: 1 }])).toThrow(ProjectFormatError);
    expect(bad([{ ...lut, size: 66 }])).toThrow(ProjectFormatError);
    expect(bad([{ ...lut, data: lut.data.slice(4) }])).toThrow(/LUT 1 is invalid/);
    expect(bad([{ ...lut, id: '' }])).toThrow(ProjectFormatError);
    expect(bad([lut, lut])).toThrow(/LUT twice/);
    expect(() => parseProject(JSON.stringify({ ...project(), luts: undefined }))).toThrow(
      /invalid "luts"/,
    );
  });
});
