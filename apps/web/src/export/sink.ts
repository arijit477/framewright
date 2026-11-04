import { BufferTarget, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny';
import { EXPORTS_DIR, type ExportDestination, type ExportOutput } from './protocol';

/**
 * Where the export worker writes the encoded file. Every sink except the
 * last-resort memory one streams to disk, writing each chunk at its file
 * position as it's produced.
 */
export interface ExportSink {
  readonly target: Target;
  /** True when the file is streamed (MP4 then reserves space for the index). */
  readonly streaming: boolean;
  /** Call after `output.finalize()`. */
  finish(): Promise<ExportOutput>;
  /** Call on cancel or error: discards whatever was written. */
  abort(): Promise<void>;
}

/**
 * OPFS synchronous access handles are worker-only, so their types live in the
 * WebWorker lib, which conflicts with the DOM lib this project uses. This is
 * the part of the API used here.
 */
interface SyncAccessHandle {
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type SyncCapableHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
};

/** Large chunks keep the number of disk writes low (mediabunny's default is 16 MiB). */
const CHUNKED = { chunked: true } as const;

export async function openSink(destination: ExportDestination, name: string): Promise<ExportSink> {
  if (destination.type === 'file') return FileSink.open(destination.handle);
  return (await StorageSink.open(name)) ?? new MemorySink();
}

/** A file the user picked (File System Access API). */
class FileSink implements ExportSink {
  readonly streaming = true;

  private constructor(
    private readonly handle: FileSystemFileHandle,
    private readonly writable: FileSystemWritableFileStream,
    readonly target: Target,
  ) {}

  static async open(handle: FileSystemFileHandle): Promise<FileSink> {
    // Writes go to a temporary swap file; the real file only changes on close.
    const writable = await handle.createWritable();
    return new FileSink(handle, writable, new StreamTarget(writable, CHUNKED));
  }

  async finish(): Promise<ExportOutput> {
    // finalize() has closed the stream, committing the file.
    return { kind: 'file', bytes: (await this.handle.getFile()).size };
  }

  async abort(): Promise<void> {
    // Discards the swap file, so a cancelled export never half-overwrites a file.
    await this.writable.abort().catch(() => {});
  }
}

/**
 * A file in browser storage (OPFS), written through a synchronous access
 * handle, which every browser with OPFS supports inside workers. The main
 * thread then downloads it from storage without loading it into memory.
 */
class StorageSink implements ExportSink {
  readonly streaming = true;

  private constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly name: string,
    private readonly access: SyncAccessHandle,
    readonly target: Target,
  ) {}

  static async open(name: string): Promise<StorageSink | null> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(EXPORTS_DIR, { create: true });
      const handle: SyncCapableHandle = await dir.getFileHandle(name, { create: true });
      if (typeof handle.createSyncAccessHandle !== 'function') return null;
      const access = await handle.createSyncAccessHandle();
      access.truncate(0);
      const writable = new WritableStream<StreamTargetChunk>({
        write(chunk) {
          let written = 0;
          // write() may write less than asked; loop until the chunk is on disk.
          while (written < chunk.data.byteLength) {
            written += access.write(chunk.data.subarray(written), { at: chunk.position + written });
          }
        },
        close() {
          access.flush();
          access.close();
        },
      });
      return new StorageSink(dir, name, access, new StreamTarget(writable, CHUNKED));
    } catch {
      return null; // no OPFS (e.g. some private-browsing modes): fall back to memory
    }
  }

  async finish(): Promise<ExportOutput> {
    const file = await (await this.dir.getFileHandle(this.name)).getFile();
    return { kind: 'storage', name: this.name, bytes: file.size };
  }

  async abort(): Promise<void> {
    try {
      this.access.close();
    } catch {
      // already closed
    }
    await this.dir.removeEntry(this.name).catch(() => {});
  }
}

/** Last resort: the whole file in memory (the original behaviour). */
class MemorySink implements ExportSink {
  readonly streaming = false;
  readonly target = new BufferTarget();

  async finish(): Promise<ExportOutput> {
    const buffer = this.target.buffer;
    if (!buffer) throw new Error('The encoder produced no data.');
    return { kind: 'memory', buffer, bytes: buffer.byteLength };
  }

  async abort(): Promise<void> {}
}
