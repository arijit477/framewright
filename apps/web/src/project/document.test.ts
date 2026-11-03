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
  type ProjectAsset,
  type ProjectDocument,
} from './document';

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
