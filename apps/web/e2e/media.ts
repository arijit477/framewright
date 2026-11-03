import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.fixtures');

export const FIXTURES = { video: 'tone.webm', audio: 'music.wav' } as const;
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

/** Errors reported by ffmpeg while fully decoding the file (empty = clean). */
export function decodeErrors(path: string): string {
  return ffmpegLog(['-v', 'error', '-i', path, '-f', 'null', '-']).trim();
}
