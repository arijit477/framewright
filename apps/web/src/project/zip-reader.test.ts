import { makeZip } from 'client-zip';
import { describe, expect, it } from 'vitest';
import { crc32, ZipArchive, ZipError } from './zip-reader';

const encoder = new TextEncoder();

/** Build a ZIP with the same library the app uses to write backups. */
async function clientZip(files: { name: string; input: string | Blob }[]): Promise<Blob> {
  return new Response(makeZip(files)).blob();
}

/**
 * A hand-written ZIP builder for cases client-zip doesn't produce:
 * deflated entries and ZIP64 records on small files.
 */
async function handZip(
  files: { name: string; data: string; deflate?: boolean }[],
  { zip64 = false, flags = 0 } = {},
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = encoder.encode(file.data);
    const stored = file.deflate
      ? new Uint8Array(
          await new Response(
            new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')),
          ).arrayBuffer(),
        )
      : raw;
    const name = encoder.encode(file.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, file.deflate ? 8 : 0, true);
    local.setUint32(14, crc32(raw), true);
    local.setUint32(18, stored.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, stored);

    const extra = zip64 ? new DataView(new ArrayBuffer(4 + 24)) : null;
    if (extra) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(raw.length), true);
      extra.setBigUint64(12, BigInt(stored.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
    }
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(8, flags, true);
    header.setUint16(10, file.deflate ? 8 : 0, true);
    header.setUint32(16, crc32(raw), true);
    header.setUint32(20, zip64 ? 0xffffffff : stored.length, true);
    header.setUint32(24, zip64 ? 0xffffffff : raw.length, true);
    header.setUint16(28, name.length, true);
    header.setUint16(30, extra ? extra.byteLength : 0, true);
    header.setUint32(42, zip64 ? 0xffffffff : offset, true);
    central.push(new Uint8Array(header.buffer), name);
    if (extra) central.push(new Uint8Array(extra.buffer));
    offset += 30 + name.length + stored.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const tail: Uint8Array<ArrayBuffer>[] = [];
  if (zip64) {
    const z64 = new DataView(new ArrayBuffer(56));
    z64.setUint32(0, 0x06064b50, true);
    z64.setBigUint64(4, 44n, true);
    z64.setBigUint64(24, BigInt(files.length), true);
    z64.setBigUint64(32, BigInt(files.length), true);
    z64.setBigUint64(40, BigInt(cdSize), true);
    z64.setBigUint64(48, BigInt(offset), true);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(offset + cdSize), true);
    locator.setUint32(16, 1, true);
    tail.push(new Uint8Array(z64.buffer), new Uint8Array(locator.buffer));
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, zip64 ? 0xffff : files.length, true);
  eocd.setUint16(10, zip64 ? 0xffff : files.length, true);
  eocd.setUint32(12, zip64 ? 0xffffffff : cdSize, true);
  eocd.setUint32(16, zip64 ? 0xffffffff : offset, true);
  return new Blob([...parts, ...central, ...tail, new Uint8Array(eocd.buffer)]);
}

const expectZipError = async (promise: Promise<unknown>, message: RegExp) => {
  await expect(promise).rejects.toBeInstanceOf(ZipError);
  await expect(promise).rejects.toThrow(message);
};

describe('ZipArchive', () => {
  it('reads archives written by client-zip (the backup writer)', async () => {
    const video = new Blob([new Uint8Array(5000).map((_, i) => i % 251)]);
    const zip = await ZipArchive.open(
      await clientZip([
        { name: 'project.json', input: '{"hello":"wörld"}' },
        { name: 'media/a1/clip.mp4', input: video },
      ]),
    );
    expect(zip.entries.map((e) => e.name)).toEqual(['project.json', 'media/a1/clip.mp4']);
    expect(await zip.text(zip.get('project.json')!)).toBe('{"hello":"wörld"}');
    const media = await zip.blob(zip.get('media/a1/clip.mp4')!);
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(
      new Uint8Array(await video.arrayBuffer()),
    );
  });

  it('reads deflated entries (archives re-zipped by other tools)', async () => {
    const text = 'compress me '.repeat(200);
    const zip = await ZipArchive.open(
      await handZip([{ name: 'a.txt', data: text, deflate: true }]),
    );
    expect(zip.get('a.txt')!.compressedSize).toBeLessThan(text.length);
    expect(await zip.text(zip.get('a.txt')!)).toBe(text);
  });

  it('reads ZIP64 records', async () => {
    const zip = await ZipArchive.open(
      await handZip(
        [
          { name: 'x.json', data: '{"big":true}' },
          { name: 'y', data: 'yy' },
        ],
        {
          zip64: true,
        },
      ),
    );
    expect(zip.entries.map((e) => [e.name, e.size])).toEqual([
      ['x.json', 12],
      ['y', 2],
    ]);
    expect(await zip.text(zip.get('x.json')!)).toBe('{"big":true}');
  });

  it('rejects files that are not ZIPs', async () => {
    await expectZipError(ZipArchive.open(new Blob(['hello'])), /not a ZIP/);
    await expectZipError(ZipArchive.open(new Blob(['x'.repeat(1000)])), /not a ZIP/);
  });

  it('rejects truncated archives (e.g. an interrupted download)', async () => {
    const full = await clientZip([{ name: 'project.json', input: '{}'.repeat(500) }]);
    await expectZipError(ZipArchive.open(full.slice(0, full.size - 30)), /not a ZIP|truncated/);
  });

  it('detects corrupted contents by checksum', async () => {
    const zip = await handZip([{ name: 'p.json', data: '{"a":1}' }]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    bytes[30 + 'p.json'.length] = '['.charCodeAt(0); // flip the first content byte
    const archive = await ZipArchive.open(new Blob([bytes]));
    await expectZipError(archive.text(archive.get('p.json')!), /checksum/);
  });

  it('refuses encrypted entries', async () => {
    await expectZipError(
      ZipArchive.open(await handZip([{ name: 's', data: 'secret' }], { flags: 1 })),
      /encrypted/,
    );
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });
});
