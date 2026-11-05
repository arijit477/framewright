import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.fixtures');

export const FIXTURES = {
  video: 'tone.webm',
  audio: 'music.wav',
  overlay: 'red.webm',
  beep: 'beep.webm',
  steps: 'steps.wav',
  lut: 'swap.cube',
  speech: 'jfk.wav',
  silence: 'silence.wav',
  pauses: 'pauses.wav',
  portrait: 'portrait.jpg',
  facePan: 'face-pan.webm',
} as const;
export const fixture = (name: string) => join(FIXTURE_DIR, name);

export interface ProbeResult {
  streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
  format: { duration: string };
}

/** Inspect a media file with ffprobe: an independent check of what we produced. */
export function probe(path: string): ProbeResult {
  const json = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height:format=duration',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(json.toString()) as ProbeResult;
}

/** Number of video frames ffmpeg can actually decode. */
export function countFrames(path: string): number {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'csv=p=0',
    path,
  ]);
  return Number(out.toString().trim());
}

/** Run ffmpeg without a shell and return its log (ffmpeg logs to stderr). */
function ffmpegLog(args: string[]): string {
  const result = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result.stderr;
}

/** Peak audio level in dBFS, as measured by ffmpeg's volumedetect. */
export function peakDb(path: string): number {
  const log = ffmpegLog(['-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const match = /max_volume: (-?[\d.]+) dB/.exec(log);
  if (!match) throw new Error(`No audio level found in ${path}`);
  return Number(match[1]);
}

/**
 * Peak level in dBFS of one frequency over `[from, from + duration)` seconds,
 * to tell overlapping test tones apart. Four cascaded band-passes keep an
 * octave-away tone at least ~23 dB down (measured).
 */
export function toneDb(path: string, hz: number, from: number, duration: number): number {
  const band = `bandpass=f=${hz}:width_type=q:w=4`;
  const filter = `${band},${band},${band},${band},volumedetect`;
  const log = ffmpegLog([
    '-ss',
    String(from),
    '-t',
    String(duration),
    '-i',
    path,
    '-vn',
    '-af',
    filter,
    '-f',
    'null',
    '-',
  ]);
  const match = /max_volume: (-?[\d.]+|-inf) dB/.exec(log);
  if (!match) throw new Error(`No audio level found in ${path}`);
  return match[1] === '-inf' ? -Infinity : Number(match[1]);
}

/**
 * The test pattern's burned-in timestamp (top-left) as a black-and-white mask:
 * a reliable way to tell which source moment a frame shows, because encoding
 * noise doesn't survive the threshold.
 */
export function timestampMask(path: string, seconds: number): Uint8Array {
  const gray = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(seconds),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    'crop=118:40:0:0,scale=118:40',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-',
  ]);
  return Uint8Array.from(gray, (v) => (v > 110 ? 1 : 0));
}

/** Percentage of pixels that differ between two masks (same moment ≈ 0.1, others ≥ 1, measured). */
export function maskDifference(a: Uint8Array, b: Uint8Array): number {
  let different = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
  return (different / a.length) * 100;
}

/** Errors reported by ffmpeg while fully decoding the file (empty = clean). */
export function decodeErrors(path: string): string {
  return ffmpegLog(['-v', 'error', '-i', path, '-f', 'null', '-']).trim();
}

/**
 * One video frame at `seconds`, cropped and scaled, as raw RGB bytes. Used to
 * check what an exported file shows at a given moment.
 */
export function frameRgb(
  path: string,
  seconds: number,
  {
    crop = 'iw:ih:0:0',
    width = 32,
    height = 18,
  }: { crop?: string; width?: number; height?: number } = {},
): Buffer {
  return execFileSync('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(seconds),
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    `crop=${crop},scale=${width}:${height}:flags=area`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]);
}

/** Average colour of a frame region. */
export function averageRgb(rgb: Buffer): [number, number, number] {
  const sum = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3) for (let c = 0; c < 3; c++) sum[c]! += rgb[i + c]!;
  const n = rgb.length / 3;
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
}

/** Mean absolute difference between two frames of the same size (0–255). */
export function frameDifference(a: Buffer, b: Buffer): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i]! - b[i]!);
  return total / a.length;
}

/** Top-level box types of an MP4, in order (fast start = "moov" before "mdat"). */
export function mp4Boxes(path: string): string[] {
  const data = readFileSync(path);
  const boxes: string[] = [];
  let at = 0;
  while (at + 8 <= data.length) {
    let size = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    if (size === 1) size = Number(data.readBigUInt64BE(at + 8)); // 64-bit size
    if (size === 0) size = data.length - at; // box runs to the end of the file
    if (size < 8) break;
    boxes.push(type);
    at += size;
  }
  return boxes;
}
