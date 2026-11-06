import { create } from 'zustand';
import {
  cleanName,
  createProject,
  matchFile,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectFormatError,
  type ProjectDocument,
  type ProjectSummary,
  uniqueName,
} from '../project/document';
import {
  backupFileName,
  BACKUP_EXTENSION,
  createBackupStream,
  readBackup,
} from '../project/backup';
import { flushPendingEdits } from '../lib/pending-edits';
import { SaveScheduler, type SaveState } from '../project/save-scheduler';
import { ProjectStorage, storageEstimate } from '../project/storage';
import {
  loadProject,
  notify,
  relinkAsset,
  snapshotProject,
  subscribeEditor,
  useEditor,
} from './editor';

const AUTOSAVE_DELAY_MS = 800;
const LAST_PROJECT_KEY = 'framewright.lastProject';

/** The open project's identity (its content lives in the editor store). */
interface CurrentProject {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProjectState {
  /** False if this browser can't store projects; editing still works. */
  persistent: boolean;
  current: CurrentProject | null;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: string | null;
  dialogOpen: boolean;
  projects: ProjectSummary[];
  storage: { usage: number; quota: number } | null;
  /** Media files still being copied into project storage. */
  copying: number;
  /** A long-running project task, shown in the dialog (e.g. "Importing backup…"). */
  busy: string | null;
}

export const useProject = create<ProjectState>(() => ({
  persistent: false,
  current: null,
  saveState: 'saved',
  saveError: null,
  lastSavedAt: null,
  dialogOpen: false,
  projects: [],
  storage: null,
  copying: 0,
  busy: null,
}));

const set = useProject.setState;
const get = useProject.getState;

let storage: ProjectStorage | null = null;
let releaseLock: (() => void) | null = null;
let persistenceRequested = false;

const scheduler = new SaveScheduler(saveNow, AUTOSAVE_DELAY_MS, (saveState, error) => {
  set({
    saveState,
    saveError: saveState === 'error' ? describe(error) : null,
    ...(saveState === 'saved' && get().current ? { lastSavedAt: new Date().toISOString() } : {}),
  });
});

// ---------------------------------------------------------------- start-up

/** Open the last project (or a new one). Call once, after initEditor(). */
export async function initProjects(): Promise<void> {
  storage = await ProjectStorage.open();
  set({ persistent: storage !== null });
  subscribeEditor((event) => {
    if (event.type === 'changed') scheduler.markDirty();
    if (event.type === 'assetAdded') void storeMedia(event.id, event.file);
  });
  installUnloadGuards();

  if (!storage) {
    notify(
      'info',
      "This browser can't save projects, so your work is lost when you close the tab.",
    );
    await newProject();
    return;
  }
  const projects = await storage.list();
  set({ projects });
  const last = localStorage.getItem(LAST_PROJECT_KEY);
  const candidates = [
    ...projects.filter((p) => p.id === last),
    ...projects.filter((p) => p.id !== last),
  ];
  for (const candidate of candidates) {
    if (await openProject(candidate.id, { quiet: true })) return;
  }
  await newProject();
}

// ---------------------------------------------------------------- lifecycle

/** Open a stored project. Returns false (and keeps the current one) on failure. */
export async function openProject(id: string, { quiet = false } = {}): Promise<boolean> {
  if (!storage || get().current?.id === id) return get().current?.id === id;
  await closeCurrent();

  const release = await acquireLock(id);
  if (!release) {
    if (!quiet) notify('error', 'That project is open in another tab.');
    return false;
  }
  try {
    const doc = await storage.read(id);
    const files = new Map<string, File>();
    await Promise.all(
      doc.assets.map(async (asset) => {
        const file = await storage!.getMedia(id, asset);
        if (file) files.set(asset.id, file);
      }),
    );
    await loadProject({ timeline: doc.timeline, assets: doc.assets, luts: doc.luts, files });
    releaseLock = release;
    scheduler.reset();
    set({
      current: { id: doc.id, name: doc.name, createdAt: doc.createdAt },
      lastSavedAt: doc.updatedAt,
      dialogOpen: false,
    });
    rememberLast(id);
    // Missing media is shown by the banner (MissingMediaBanner), not a toast.
    return true;
  } catch (error) {
    release();
    if (!quiet) {
      const reason = error instanceof ProjectFormatError ? error.message : describe(error);
      notify('error', `Couldn't open the project: ${reason}`);
    }
    return false;
  }
}

/** Start an empty project. It is written to storage on the first change. */
export async function newProject(): Promise<void> {
  await closeCurrent();
  const doc = createProject(crypto.randomUUID(), new Date());
  releaseLock = await acquireLock(doc.id);
  await loadProject({ timeline: null, assets: [], luts: [], files: new Map() });
  scheduler.reset();
  set({
    current: { id: doc.id, name: doc.name, createdAt: doc.createdAt },
    lastSavedAt: null,
    dialogOpen: false,
  });
  rememberLast(doc.id);
}

export function renameProject(name: string): void {
  const current = get().current;
  if (!current) return;
  const cleaned = cleanName(name);
  if (cleaned === current.name) return;
  set({ current: { ...current, name: cleaned } });
  scheduler.markDirty();
}

/** Delete a project (and its media). Deleting the open project starts a new one. */
export async function deleteProject(id: string): Promise<void> {
  if (!storage) return;
  const isCurrent = get().current?.id === id;
  if (isCurrent) {
    scheduler.reset(); // don't resurrect it with a pending save
    releaseLock?.();
    releaseLock = null;
  } else {
    const release = await acquireLock(id);
    if (!release) {
      notify('error', 'That project is open in another tab, so it can’t be deleted here.');
      return;
    }
    release();
  }
  try {
    await storage.remove(id);
  } catch (error) {
    // A never-saved project has nothing on disk; anything else is a real failure.
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
      notify('error', `Couldn't delete the project: ${describe(error)}`);
      return;
    }
  }
  if (isCurrent) {
    set({ current: null });
    await newProject();
  }
  await refreshList();
}

/** Ctrl+S: write now and confirm. */
export async function saveProject(): Promise<void> {
  if (!storage) {
    notify('info', "This browser can't save projects.");
    return;
  }
  flushPendingEdits();
  scheduler.markDirty();
  await scheduler.flush();
  if (get().saveState === 'saved') notify('info', 'Project saved.');
}

/** Match chosen files to missing media by name (and size), and relink them. */
export async function relinkMissing(files: readonly File[]): Promise<void> {
  const missing = Object.values(useEditor.getState().assets).filter((a) => a.missing);
  let linked = 0;
  for (const asset of missing) {
    const file = matchFile(asset, files);
    if (file && (await relinkAsset(asset.id, file))) linked++;
  }
  const left = missing.length - linked;
  notify(
    left === 0 ? 'info' : 'error',
    left === 0
      ? `Relinked ${linked} media file${linked === 1 ? '' : 's'}.`
      : `Relinked ${linked}; ${left} still missing (choose files with the same names).`,
  );
}

// ---------------------------------------------------------------- backups

/**
 * Save a project as a .framewright backup (a ZIP with the project and its
 * media). Streams to disk via the Save dialog where available (Chrome, Edge),
 * otherwise downloads normally.
 */
export async function downloadBackup(projectId: string): Promise<void> {
  if (!storage || get().busy) return;
  if (get().current?.id === projectId) {
    // Make sure it's on disk (with any pending edit), even if it was never edited.
    flushPendingEdits();
    scheduler.markDirty();
    await scheduler.flush();
  }
  set({ busy: 'Preparing backup…' });
  try {
    const doc = await storage.read(projectId);
    const media = new Map<string, File>();
    for (const asset of doc.assets) {
      const file = await storage.getMedia(projectId, asset);
      if (file) media.set(asset.id, file);
    }
    const fileName = backupFileName(doc.name, new Date());
    const saved = await saveStream(() => createBackupStream(doc, media), fileName);
    if (!saved) return; // the user cancelled the Save dialog
    const skipped = doc.assets.length - media.size;
    notify(
      skipped > 0 ? 'error' : 'info',
      skipped > 0
        ? `Backup saved without ${skipped} missing media file${skipped > 1 ? 's' : ''}. Relink them first to include them.`
        : `Backup saved: ${fileName}`,
    );
  } catch (error) {
    notify('error', `Couldn't create the backup: ${describe(error)}`);
  } finally {
    set({ busy: null });
  }
}

/**
 * Restore a backup as a new project (never overwriting an existing one) and
 * open it. On any failure, nothing is left behind.
 */
export async function importBackup(file: File): Promise<void> {
  if (!storage || get().busy) {
    if (!storage)
      notify('error', "This browser can't store projects, so backups can't be imported.");
    return;
  }
  set({ busy: `Importing ${file.name}…` });
  const id = crypto.randomUUID();
  try {
    const { doc, media, missing } = await readBackup(file);
    const existing = (await storage.list()).map((p) => p.name);
    const restored: ProjectDocument = {
      ...doc,
      id,
      name: uniqueName(doc.name, existing),
      updatedAt: new Date().toISOString(),
    };
    for (const [assetId, blob] of media) await storage.putMedia(id, assetId, blob);
    await storage.write(restored); // last: the project only appears once complete
    set({ busy: null });
    if (await openProject(id)) {
      notify(
        missing.length > 0 ? 'error' : 'info',
        missing.length > 0
          ? `Imported "${restored.name}"; ${missing.length} media file${missing.length > 1 ? 's' : ''} were not in the backup.`
          : `Imported "${restored.name}".`,
      );
    }
    await refreshList();
  } catch (error) {
    await storage.remove(id).catch(() => {}); // roll back a partial import
    notify('error', describe(error));
  } finally {
    set({ busy: null });
  }
}

export const isBackupFile = (file: File) => file.name.toLowerCase().endsWith(BACKUP_EXTENSION);

/** Write a stream to a user-chosen file. Returns false if the user cancelled. */
async function saveStream(stream: () => ReadableStream<Uint8Array>, fileName: string) {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker({
        suggestedName: fileName,
        types: [
          { description: 'Framewright backup', accept: { 'application/zip': [BACKUP_EXTENSION] } },
        ],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      throw error;
    }
    await stream().pipeTo(await handle.createWritable());
    return true;
  }
  // Fallback: build the file (browsers back large blobs with disk) and download it.
  const blob = await new Response(stream()).blob();
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

// ---------------------------------------------------------------- dialog

export async function openProjectsDialog(): Promise<void> {
  set({ dialogOpen: true });
  await refreshList();
}

export const closeProjectsDialog = () => set({ dialogOpen: false });

async function refreshList() {
  if (!storage) return;
  const [projects, estimate] = await Promise.all([storage.list(), storageEstimate()]);
  set({ projects, storage: estimate });
}

// ---------------------------------------------------------------- internals

async function saveNow(): Promise<void> {
  const current = get().current;
  if (!storage || !current) return;
  if (!persistenceRequested) {
    persistenceRequested = true;
    void ProjectStorage.requestPersistence();
  }
  const { timeline, durationUs, assets, luts } = snapshotProject();
  const doc: ProjectDocument = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: current.id,
    name: current.name,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    durationUs,
    timeline,
    assets,
    luts,
  };
  await storage.write(doc);
}

/** Copy an imported file into the project so it's there after a reload. */
async function storeMedia(assetId: string, file: File) {
  const current = get().current;
  if (!storage || !current) return;
  set((s) => ({ copying: s.copying + 1 }));
  try {
    await storage.putMedia(current.id, assetId, file);
  } catch (error) {
    notify(
      'error',
      `Couldn't keep a copy of ${file.name} (${describe(error)}). ` +
        'It will need relinking after a reload. Free up disk space to avoid this.',
    );
  } finally {
    set((s) => ({ copying: s.copying - 1 }));
  }
}

async function closeCurrent() {
  await scheduler.flush();
  releaseLock?.();
  releaseLock = null;
}

/**
 * Hold an exclusive Web Lock while a project is open, so two tabs can't
 * overwrite each other's work. Resolves to a release function, or null if
 * another tab holds it. Browsers without Web Locks get a no-op lock.
 */
async function acquireLock(projectId: string): Promise<(() => void) | null> {
  if (!navigator.locks) return () => {};
  return new Promise((resolve) => {
    void navigator.locks.request(
      `framewright-project-${projectId}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        // Keep the lock until release() is called.
        return new Promise<void>((release) => resolve(release));
      },
    );
  });
}

function installUnloadGuards() {
  // Save when the tab is hidden: the most reliable moment before it may be killed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    flushPendingEdits();
    void scheduler.flush();
  });
  window.addEventListener('beforeunload', (event) => {
    flushPendingEdits();
    if (!storage || !scheduler.hasUnsavedChanges) return;
    void scheduler.flush();
    event.preventDefault(); // ask the user to stay while we save
  });
}

function rememberLast(id: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Not critical: we'd just open the most recent project instead.
  }
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'the browser storage is full';
  }
  return error instanceof Error ? error.message : String(error);
}
