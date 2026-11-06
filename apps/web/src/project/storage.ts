import {
  parseProject,
  serializeProject,
  summarize,
  type ProjectAsset,
  type ProjectDocument,
  type ProjectSummary,
} from './document';

/**
 * Project persistence in the Origin Private File System (OPFS): fast,
 * private to this site, and available without permission prompts.
 *
 *   projects/<projectId>/project.json   the document
 *   projects/<projectId>/media/<assetId>  a copy of each imported file
 *
 * Writes go through `createWritable()`, which writes to a temporary file and
 * swaps it in on close(): a crash mid-save leaves the previous version intact.
 */
export class ProjectStorage {
  private constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** Null when this browser can't persist projects (no OPFS or no writable streams). */
  static async open(): Promise<ProjectStorage | null> {
    try {
      if (!navigator.storage?.getDirectory) return null;
      const origin = await navigator.storage.getDirectory();
      const root = await origin.getDirectoryHandle('projects', { create: true });
      const probe = await root.getFileHandle('.probe', { create: true });
      if (typeof probe.createWritable !== 'function') return null;
      await root.removeEntry('.probe');
      return new ProjectStorage(root);
    } catch {
      return null;
    }
  }

  /** Ask the browser not to evict our data under storage pressure. */
  static async requestPersistence(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }

  async list(): Promise<ProjectSummary[]> {
    const summaries: ProjectSummary[] = [];
    for await (const [name, handle] of this.root.entries()) {
      if (handle.kind !== 'directory' || !isSafeId(name)) continue;
      try {
        summaries.push(summarize(await this.read(name)));
      } catch {
        // A damaged project shouldn't hide the others.
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async read(projectId: string): Promise<ProjectDocument> {
    const dir = await this.projectDir(projectId, false);
    const file = await (await dir.getFileHandle('project.json')).getFile();
    return parseProject(await file.text());
  }

  async write(doc: ProjectDocument): Promise<void> {
    const dir = await this.projectDir(doc.id, true);
    const handle = await dir.getFileHandle('project.json', { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(serializeProject(doc));
      await writable.close(); // atomic swap
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
  }

  async remove(projectId: string): Promise<void> {
    assertSafeId(projectId);
    await this.root.removeEntry(projectId, { recursive: true });
  }

  /** Copy a media file into the project, streaming (large files never sit in memory). */
  async putMedia(projectId: string, assetId: string, file: Blob): Promise<File> {
    assertSafeId(assetId);
    const media = await (
      await this.projectDir(projectId, true)
    ).getDirectoryHandle('media', {
      create: true,
    });
    const handle = await media.getFileHandle(assetId, { create: true });
    const writable = await handle.createWritable();
    try {
      await file.stream().pipeTo(writable); // closes (commits) the writable on success
    } catch (error) {
      await writable.abort().catch(() => {});
      await media.removeEntry(assetId).catch(() => {});
      throw error;
    }
    return handle.getFile();
  }

  /**
   * The stored copy of a media file, or null if it's missing. It's stored
   * under the asset's id, with no type; it comes back with the original name
   * and type, which some files need to be recognised (images have no
   * container for the decoder to sniff).
   */
  async getMedia(
    projectId: string,
    asset: Pick<ProjectAsset, 'id' | 'name' | 'type' | 'lastModified'>,
  ): Promise<File | null> {
    assertSafeId(asset.id);
    try {
      const dir = await this.projectDir(projectId, false);
      const media = await dir.getDirectoryHandle('media');
      const stored = await (await media.getFileHandle(asset.id)).getFile();
      // A File around the stored one: no copy is made.
      return new File([stored], asset.name, {
        type: asset.type,
        lastModified: asset.lastModified,
      });
    } catch {
      return null;
    }
  }

  async removeMedia(projectId: string, assetId: string): Promise<void> {
    assertSafeId(assetId);
    const dir = await this.projectDir(projectId, false);
    const media = await dir.getDirectoryHandle('media');
    await media.removeEntry(assetId).catch(() => {});
  }

  private async projectDir(projectId: string, create: boolean) {
    assertSafeId(projectId);
    return this.root.getDirectoryHandle(projectId, { create });
  }
}

/** Storage used and available, for the project dialog. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    return { usage, quota };
  } catch {
    return null;
  }
}

/** IDs become directory names, so only allow a safe, bounded character set. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isSafeId = (id: string): boolean => SAFE_ID.test(id);

function assertSafeId(id: string) {
  if (!isSafeId(id)) throw new Error(`Invalid id: ${JSON.stringify(id)}`);
}
