/**
 * Minimal, streaming-friendly ZIP reader for backup files.
 *
 * It reads only the central directory into memory; entry data is returned as
 * `Blob.slice()`s of the original file, so a multi-gigabyte backup imports
 * without being loaded into RAM. Supports stored and deflated entries and
 * ZIP64 (archives or entries over 4 GB). Every offset and size is checked
 * against the real file length, so a damaged file fails cleanly.
 *
 * Spec: PKWARE APPNOTE.TXT, sections 4.3 and 4.5.3.
 */

export class ZipError extends Error {
  override name = 'ZipError';
}

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflated. */
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x1;
const MAX_ENTRIES = 100_000;

export class ZipArchive {
  private readonly byName: Map<string, ZipEntry>;

  private constructor(
    private readonly file: Blob,
    readonly entries: readonly ZipEntry[],
  ) {
    this.byName = new Map(entries.map((e) => [e.name, e]));
  }

  static async open(file: Blob): Promise<ZipArchive> {
    const { count, cdOffset, cdSize } = await readEndOfCentralDirectory(file);
    if (cdOffset + cdSize > file.size) throw new ZipError('The file is truncated.');
    if (count > MAX_ENTRIES) throw new ZipError('The archive has too many entries.');
    const cd = await bytes(file, cdOffset, cdSize);
    return new ZipArchive(file, parseCentralDirectory(cd, count, file.size));
  }

  get(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  /** The entry's contents. Stored entries are zero-copy slices of the file. */
  async blob(entry: ZipEntry): Promise<Blob> {
    const start = await this.dataOffset(entry);
    const raw = this.file.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return raw;
    const inflated = await new Response(
      raw.stream().pipeThrough(new DecompressionStream('deflate-raw')),
    ).blob();
    if (inflated.size !== entry.size) throw new ZipError(`"${entry.name}" is damaged.`);
    return inflated;
  }

  /** Read a (small) entry as text, verifying its checksum. */
  async text(entry: ZipEntry): Promise<string> {
    const data = new Uint8Array(await (await this.blob(entry)).arrayBuffer());
    if (crc32(data) !== entry.crc32) throw new ZipError(`"${entry.name}" is damaged (checksum).`);
    return new TextDecoder().decode(data);
  }

  private async dataOffset(entry: ZipEntry): Promise<number> {
    const header = new DataView((await bytes(this.file, entry.localHeaderOffset, 30)).buffer);
    if (header.getUint32(0, true) !== SIG_LOCAL) throw new ZipError(`"${entry.name}" is damaged.`);
    const start =
      entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    if (start + entry.compressedSize > this.file.size) {
      throw new ZipError(`"${entry.name}" is truncated.`);
    }
    return start;
  }
}

async function readEndOfCentralDirectory(file: Blob) {
  if (file.size < EOCD_SIZE) throw new ZipError('This is not a ZIP file.');
  // The EOCD record ends the file, followed only by an optional comment.
  const tailStart = Math.max(0, file.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await bytes(file, tailStart, file.size - tailStart);
  const view = new DataView(tail.buffer);
  let at = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new ZipError('This is not a ZIP file, or it is truncated.');

  let count = view.getUint16(at + 10, true);
  let cdSize = view.getUint32(at + 12, true);
  let cdOffset = view.getUint32(at + 16, true);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64: a locator sits right before the EOCD and points at the ZIP64 EOCD.
    const locator = at - 20;
    if (locator < 0 || view.getUint32(locator, true) !== SIG_ZIP64_LOCATOR) {
      throw new ZipError('The ZIP64 directory is missing.');
    }
    const z64Offset = u64(view, locator + 8);
    const z64 = new DataView((await bytes(file, z64Offset, 56)).buffer);
    if (z64.getUint32(0, true) !== SIG_ZIP64_EOCD)
      throw new ZipError('The ZIP64 directory is damaged.');
    count = u64(z64, 32);
    cdSize = u64(z64, 40);
    cdOffset = u64(z64, 48);
  }
  return { count, cdSize, cdOffset };
}

function parseCentralDirectory(cd: Uint8Array, count: number, fileSize: number): ZipEntry[] {
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > cd.length || view.getUint32(at, true) !== SIG_CENTRAL) {
      throw new ZipError('The archive directory is damaged.');
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    let compressedSize = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let localHeaderOffset = view.getUint32(at + 42, true);
    const end = at + 46 + nameLength + extraLength + commentLength;
    if (end > cd.length) throw new ZipError('The archive directory is damaged.');
    const name = decoder.decode(cd.subarray(at + 46, at + 46 + nameLength));

    // ZIP64 extended information: present fields replace the 0xFFFFFFFF placeholders, in order.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) {
          size = u64(view, field);
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(view, field);
          field += 8;
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(view, field);
      }
      extra += 4 + length;
    }

    if (flags & FLAG_ENCRYPTED) throw new ZipError(`"${name}" is encrypted; that's not supported.`);
    if (method !== 0 && method !== 8) {
      throw new ZipError(`"${name}" uses an unsupported compression method (${method}).`);
    }
    if (method === 0 && compressedSize !== size) throw new ZipError(`"${name}" is damaged.`);
    if (localHeaderOffset + compressedSize > fileSize)
      throw new ZipError(`"${name}" is truncated.`);
    entries.push({ name, method, compressedSize, size, crc32: crc, localHeaderOffset });
    at = end;
  }
  return entries;
}

async function bytes(file: Blob, start: number, length: number): Promise<Uint8Array> {
  if (start < 0 || length < 0 || start + length > file.size) {
    throw new ZipError('The file is truncated or damaged.');
  }
  return new Uint8Array(await file.slice(start, start + length).arrayBuffer());
}

function u64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('The archive is too large.');
  return Number(value);
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE), as used by ZIP. */
export function crc32(data: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
