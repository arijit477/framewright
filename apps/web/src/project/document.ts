/**
 * The on-disk project format. Versioned and validated: a project written by
 * any version of the app either loads correctly (via migrations) or fails with
 * a clear error. It is never half-loaded.
 *
 * The timeline itself is the engine's JSON (validated again by the engine on
 * load); this layer owns the envelope and the media metadata.
 */

export const PROJECT_FORMAT = 'framewright.project';
/** Bump when the shape changes, and add a migration from the previous version. */
export const PROJECT_VERSION = 1;
export const DEFAULT_PROJECT_NAME = 'Untitled project';
export const MAX_NAME_LENGTH = 100;

/** What we remember about an imported file, so it can be found again and relinked. */
export interface ProjectAsset {
  id: string;
  name: string;
  /** MIME type, e.g. video/mp4. */
  type: string;
  size: number;
  lastModified: number;
  durationUs: number;
  width: number;
  height: number;
  codec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface ProjectDocument {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Timeline length, stored for the project list (no engine needed to show it). */
  durationUs: number;
  /** The engine's serialised timeline, or null for a project that was never edited. */
  timeline: unknown;
  assets: ProjectAsset[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  durationUs: number;
  clipCount: number;
}

export class ProjectFormatError extends Error {
  override name = 'ProjectFormatError';
}

export function createProject(id: string, now: Date, name = DEFAULT_PROJECT_NAME): ProjectDocument {
  const timestamp = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id,
    name: cleanName(name),
    createdAt: timestamp,
    updatedAt: timestamp,
    durationUs: 0,
    timeline: null,
    assets: [],
  };
}

/** Trim, collapse whitespace, cap the length, and never return an empty name. */
export function cleanName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return cleaned || DEFAULT_PROJECT_NAME;
}

export function serializeProject(doc: ProjectDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Parse, validate and migrate a stored project. Throws ProjectFormatError on bad input. */
export function parseProject(text: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('The project file is not valid JSON (it may be damaged).');
  }
  if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError('This is not a Framewright project file.');
  }
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError('The project file has no valid version.');
  }
  if (version > PROJECT_VERSION) {
    throw new ProjectFormatError(
      'This project was saved by a newer version of Framewright. Please update the app to open it.',
    );
  }
  return validate(migrate(raw, version));
}

/**
 * Upgrade older documents one version at a time. Add `case N:` for each new
 * version, transforming a version-N document into version N+1.
 */
function migrate(doc: Record<string, unknown>, from: number): Record<string, unknown> {
  let current = doc;
  for (let version = from; version < PROJECT_VERSION; version++) {
    switch (version) {
      // No migrations yet: version 1 is the first format.
      default:
        throw new ProjectFormatError(`No migration from project version ${version}.`);
    }
  }
  current = { ...current, version: PROJECT_VERSION };
  return current;
}

function validate(raw: Record<string, unknown>): ProjectDocument {
  const field = <T>(name: string, check: (v: unknown) => v is T): T => {
    const value = raw[name];
    if (!check(value)) throw new ProjectFormatError(`The project file has an invalid "${name}".`);
    return value;
  };
  const assets = field('assets', Array.isArray).map(validateAsset);
  const ids = new Set(assets.map((a) => a.id));
  if (ids.size !== assets.length)
    throw new ProjectFormatError('The project lists a media file twice.');

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: field('id', isNonEmptyString),
    name: cleanName(field('name', isString)),
    createdAt: field('createdAt', isIsoDate),
    updatedAt: field('updatedAt', isIsoDate),
    durationUs: field('durationUs', isNonNegativeNumber),
    timeline: raw.timeline === null || isRecord(raw.timeline) ? raw.timeline : invalid('timeline'),
    assets,
  };
}

function validateAsset(value: unknown, index: number): ProjectAsset {
  if (!isRecord(value)) throw new ProjectFormatError(`Media entry ${index + 1} is invalid.`);
  const ok =
    isNonEmptyString(value.id) &&
    isString(value.name) &&
    isString(value.type) &&
    isNonNegativeNumber(value.size) &&
    isNonNegativeNumber(value.lastModified) &&
    isNonNegativeNumber(value.durationUs) &&
    isNonNegativeNumber(value.width) &&
    isNonNegativeNumber(value.height) &&
    (value.codec === null || isString(value.codec)) &&
    typeof value.hasVideo === 'boolean' &&
    typeof value.hasAudio === 'boolean';
  if (!ok) throw new ProjectFormatError(`Media entry ${index + 1} is invalid.`);
  return {
    id: value.id as string,
    name: value.name as string,
    type: value.type as string,
    size: value.size as number,
    lastModified: value.lastModified as number,
    durationUs: value.durationUs as number,
    width: value.width as number,
    height: value.height as number,
    codec: value.codec as string | null,
    hasVideo: value.hasVideo as boolean,
    hasAudio: value.hasAudio as boolean,
  };
}

/** Summary for the project list. */
export function summarize(doc: ProjectDocument): ProjectSummary {
  return {
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updatedAt,
    durationUs: doc.durationUs,
    clipCount: countClips(doc.timeline),
  };
}

function countClips(timeline: unknown): number {
  if (!isRecord(timeline) || !Array.isArray(timeline.tracks)) return 0;
  return timeline.tracks.reduce<number>(
    (n, track) => n + (isRecord(track) && Array.isArray(track.clips) ? track.clips.length : 0),
    0,
  );
}

/**
 * Pick the file that best matches a missing asset: same name and size first,
 * then same name. Used when the user relinks media.
 */
export function matchFile<F extends { name: string; size: number }>(
  asset: Pick<ProjectAsset, 'name' | 'size'>,
  files: readonly F[],
): F | null {
  const sameName = files.filter((f) => f.name.toLowerCase() === asset.name.toLowerCase());
  return sameName.find((f) => f.size === asset.size) ?? sameName[0] ?? null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNonNegativeNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));
const invalid = (name: string): never => {
  throw new ProjectFormatError(`The project file has an invalid "${name}".`);
};
