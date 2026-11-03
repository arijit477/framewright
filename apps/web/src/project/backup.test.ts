import { makeZip } from 'client-zip';
import { describe, expect, it } from 'vitest';
import { backupFileName, BackupError, createBackupStream, mediaPath, readBackup } from './backup';
import { createProject, type ProjectAsset, type ProjectDocument } from './document';

const NOW = new Date('2026-11-03T12:00:00.000Z');

const asset = (id: string, name: string, size: number): ProjectAsset => ({
  id,
  name,
  type: 'video/mp4',
  size,
  lastModified: NOW.getTime(),
  durationUs: 1_000_000,
  width: 1280,
  height: 720,
  codec: 'avc',
  hasVideo: true,
  hasAudio: false,
});

const bytes = (n: number, seed = 1) =>
  new Blob([Uint8Array.from({ length: n }, (_, i) => (i * seed) % 256)]);

const doc = (assets: ProjectAsset[]): ProjectDocument => ({
  ...createProject('p1', NOW, 'Holiday cut'),
  assets,
  timeline: { tracks: [], nextId: 0 },
});

const toBlob = (stream: ReadableStream<Uint8Array>) => new Response(stream).blob();

describe('project backups', () => {
  it('round-trips the project and its media', async () => {
    const a = bytes(3000, 7);
    const b = bytes(1200, 3);
    const project = doc([asset('a1', 'clip.mp4', a.size), asset('b2', 'music.wav', b.size)]);
    const backup = await toBlob(
      createBackupStream(
        project,
        new Map([
          ['a1', a],
          ['b2', b],
        ]),
      ),
    );

    const restored = await readBackup(backup);
    expect(restored.doc).toEqual(project);
    expect(restored.missing).toEqual([]);
    expect(new Uint8Array(await restored.media.get('a1')!.arrayBuffer())).toEqual(
      new Uint8Array(await a.arrayBuffer()),
    );
    expect(restored.media.get('b2')!.size).toBe(b.size);
  });

  it('lists media that was missing when the backup was made', async () => {
    const project = doc([asset('a1', 'clip.mp4', 10), asset('b2', 'gone.mov', 10)]);
    const backup = await toBlob(createBackupStream(project, new Map([['a1', bytes(10)]])));
    const restored = await readBackup(backup);
    expect([...restored.media.keys()]).toEqual(['a1']);
    expect(restored.missing).toEqual(['gone.mov']);
  });

  it('treats media whose size changed as damaged', async () => {
    const project = doc([asset('a1', 'clip.mp4', 999)]);
    const backup = await toBlob(createBackupStream(project, new Map([['a1', bytes(10)]])));
    expect((await readBackup(backup)).missing).toEqual(['clip.mp4']);
  });

  it('rejects files that are not backups, with a clear message', async () => {
    await expect(readBackup(new Blob(['not a zip']))).rejects.toThrow(BackupError);
    const foreign = await toBlob(makeZip([{ name: 'photo.jpg', input: 'jpeg' }]));
    await expect(readBackup(foreign)).rejects.toThrow(/no project.json/);
  });

  it('rejects backups whose project data is invalid', async () => {
    const broken = await toBlob(makeZip([{ name: 'project.json', input: '{"format":"other"}' }]));
    await expect(readBackup(broken)).rejects.toThrow(/project data can't be read/);
  });
});

describe('naming', () => {
  it('names backup files after the project and date', () => {
    expect(backupFileName('Holiday Cut!', NOW)).toBe('holiday-cut-2026-11-03.framewright');
    expect(backupFileName('???', NOW)).toBe('framewright-project-2026-11-03.framewright');
  });

  it('keeps media paths inside their folder', () => {
    expect(mediaPath('a1', 'clip.mp4')).toBe('media/a1/clip.mp4');
    expect(mediaPath('a1', '../../evil.mp4')).toBe('media/a1/.._.._evil.mp4');
    expect(mediaPath('a1', '  ')).toBe('media/a1/media');
  });
});
