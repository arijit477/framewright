import { makeZip } from 'client-zip';
import { slugify } from '../lib/slug';
import { parseProject, serializeProject, type ProjectDocument } from './document';
import { isSafeId } from './storage';
import { ZipArchive, ZipError } from './zip-reader';

/**
 * Project backups: a standard ZIP (renamed .framewright) holding the project
 * document and the original media files, so it can also be opened with any
 * unzip tool.
 *
 *   project.json
 *   README.txt
 *   media/<assetId>/<original file name>
 */

export const BACKUP_EXTENSION = '.framewright';
const PROJECT_ENTRY = 'project.json';

export class BackupError extends Error {
  override name = 'BackupError';
}

export function backupFileName(projectName: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return `${slugify(projectName, 'framewright-project')}-${date}${BACKUP_EXTENSION}`;
}

/** Path of a media file inside the backup. The asset id keeps names unique. */
export function mediaPath(assetId: string, fileName: string): string {
  const safe = fileName.replace(/[/\\\0]/g, '_').trim() || 'media';
  return `media/${assetId}/${safe}`;
}

/**
 * Stream a backup. Media is read lazily from `media` as the ZIP is written,
 * so memory use stays small regardless of project size. Assets without a file
 * are listed in the document but have no media (they import as missing).
 */
export function createBackupStream(
  doc: ProjectDocument,
  media: ReadonlyMap<string, Blob>,
): ReadableStream<Uint8Array> {
  const modified = new Date(doc.updatedAt);
  const files = [
    { name: PROJECT_ENTRY, input: serializeProject(doc), lastModified: modified },
    { name: 'README.txt', input: readme(doc), lastModified: modified },
    ...doc.assets.flatMap((asset) => {
      const file = media.get(asset.id);
      return file
        ? [
            {
              name: mediaPath(asset.id, asset.name),
              input: file,
              lastModified: new Date(asset.lastModified),
            },
          ]
        : [];
    }),
  ];
  return makeZip(files);
}

export interface RestoredBackup {
  doc: ProjectDocument;
  /** Media by asset id. Blobs are slices of the backup file (not loaded into memory). */
  media: Map<string, Blob>;
  /** Names of media listed in the project but not usable from the backup. */
  missing: string[];
}

/** Open and validate a backup. Throws BackupError with a user-facing message. */
export async function readBackup(file: Blob): Promise<RestoredBackup> {
  let archive: ZipArchive;
  try {
    archive = await ZipArchive.open(file);
  } catch (error) {
    throw new BackupError(`This isn't a valid Framewright backup (${reason(error)}).`);
  }
  const entry = archive.get(PROJECT_ENTRY);
  if (!entry) throw new BackupError("This ZIP isn't a Framewright backup (no project.json).");

  let doc: ProjectDocument;
  try {
    doc = parseProject(await archive.text(entry));
  } catch (error) {
    throw new BackupError(`The backup's project data can't be read: ${reason(error)}`);
  }

  const media = new Map<string, Blob>();
  const missing: string[] = [];
  for (const asset of doc.assets) {
    if (!isSafeId(asset.id)) throw new BackupError('The backup contains an invalid media id.');
    const candidates = archive.entries.filter((e) => e.name.startsWith(`media/${asset.id}/`));
    const found = candidates.length === 1 ? candidates[0]! : undefined;
    // The copy must be the same file that was imported; anything else is damage.
    if (!found || found.size !== asset.size) {
      missing.push(asset.name);
      continue;
    }
    try {
      media.set(asset.id, await archive.blob(found));
    } catch {
      missing.push(asset.name);
    }
  }
  return { doc, media, missing };
}

function readme(doc: ProjectDocument): string {
  return [
    `Framewright project backup: ${doc.name}`,
    `Saved: ${doc.updatedAt}`,
    '',
    'To restore it, open Framewright, go to Projects and choose "Import backup".',
    'The media folder contains your original files; you can also unzip this file',
    'to get them back.',
    '',
  ].join('\n');
}

const reason = (error: unknown) =>
  error instanceof ZipError || error instanceof Error ? error.message : String(error);
