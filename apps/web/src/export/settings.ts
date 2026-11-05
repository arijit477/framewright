import type { AudioCodec, VideoCodec } from 'mediabunny';
import type { AspectRatio } from '../engine/types';
import { DEFAULT_ASPECT, frameSize } from '../lib/aspect';
import { slugify } from '../lib/slug';

/**
 * Export settings and the pure maths around them. No browser APIs here, so
 * everything is unit-tested.
 */

export type ExportFormat = 'mp4' | 'webm';
export type ExportResolution = '2160p' | '1440p' | '1080p' | '720p' | '480p';
export type ExportQuality = 'low' | 'medium' | 'high';
export type ExportFps = 24 | 25 | 30 | 60;

export interface ExportSettings {
  format: ExportFormat;
  resolution: ExportResolution;
  fps: ExportFps;
  quality: ExportQuality;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  resolution: '1080p',
  fps: 30,
  quality: 'high',
};

/** 16:9 output sizes; other frame shapes keep the short edge (see `outputSize`). */
export const RESOLUTIONS: Record<ExportResolution, { width: number; height: number }> = {
  '2160p': { width: 3840, height: 2160 },
  '1440p': { width: 2560, height: 1440 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
};

export const FRAME_RATES: readonly ExportFps[] = [24, 25, 30, 60];

export const FORMATS: Record<ExportFormat, { label: string; extension: string }> = {
  mp4: { label: 'MP4 (H.264): plays everywhere', extension: 'mp4' },
  webm: { label: 'WebM (VP9): smaller, open format', extension: 'webm' },
};

/** Codecs to try per container, best first. The first one the browser can encode wins. */
export const VIDEO_CODECS: Record<ExportFormat, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
};
export const AUDIO_CODECS: Record<ExportFormat, AudioCodec[]> = {
  mp4: ['aac', 'opus'],
  webm: ['opus', 'vorbis'],
};

export const EXPORT_SAMPLE_RATE = 48_000;

/** Bits per pixel per frame. Rough, codec-agnostic targets that look clean for typical footage. */
const BITS_PER_PIXEL: Record<ExportQuality, number> = { low: 0.05, medium: 0.09, high: 0.15 };
const AUDIO_BITRATES: Record<ExportQuality, number> = {
  low: 96_000,
  medium: 128_000,
  high: 192_000,
};
const MIN_VIDEO_BITRATE = 500_000;
const MAX_VIDEO_BITRATE = 80_000_000;

/** The export's frame size: the resolution's short edge, in the project's shape. */
export function outputSize(settings: ExportSettings, aspect: AspectRatio = DEFAULT_ASPECT) {
  return frameSize(aspect, RESOLUTIONS[settings.resolution].height);
}

export function videoBitrate(
  settings: ExportSettings,
  aspect: AspectRatio = DEFAULT_ASPECT,
): number {
  const { width, height } = outputSize(settings, aspect);
  const bitrate = width * height * settings.fps * BITS_PER_PIXEL[settings.quality];
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, bitrate)));
}

export const audioBitrate = (settings: ExportSettings): number => AUDIO_BITRATES[settings.quality];

/** Number of video frames covering `durationUs` (the last partial frame counts). */
export function totalFrames(durationUs: number, fps: number): number {
  if (durationUs <= 0) return 0;
  // The epsilon stops 2.000000001 frames (float noise) from rounding up to 3.
  return Math.ceil((durationUs * fps) / 1_000_000 - 1e-6);
}

/** Presentation time of frame `index`, computed from the index so it never drifts. */
export const frameTimeUs = (index: number, fps: number): number =>
  Math.round((index * 1_000_000) / fps);

/** Rough output size, for the dialog. Real files vary with content. */
export function estimateBytes(
  durationUs: number,
  settings: ExportSettings,
  hasAudio: boolean,
  aspect: AspectRatio = DEFAULT_ASPECT,
) {
  const bitsPerSecond = videoBitrate(settings, aspect) + (hasAudio ? audioBitrate(settings) : 0);
  return Math.round(((durationUs / 1_000_000) * bitsPerSecond) / 8);
}

/** A safe, descriptive file name such as `holiday-1080p30.mp4`. */
export function exportFileName(baseName: string, settings: ExportSettings): string {
  const stem = slugify(baseName, 'framewright-export');
  return `${stem}-${settings.resolution}${settings.fps}.${FORMATS[settings.format].extension}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s} s`;
}

/** Accept only known values (e.g. settings restored from storage by an older version). */
export function sanitizeSettings(raw: unknown): ExportSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <T>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(candidate as T) ? (candidate as T) : fallback;
  const d = DEFAULT_EXPORT_SETTINGS;
  return {
    format: pick(value.format, Object.keys(FORMATS) as ExportFormat[], d.format),
    resolution: pick(
      value.resolution,
      Object.keys(RESOLUTIONS) as ExportResolution[],
      d.resolution,
    ),
    fps: pick(value.fps, FRAME_RATES, d.fps),
    quality: pick(value.quality, ['low', 'medium', 'high'] as const, d.quality),
  };
}

/**
 * Upper bounds on packet counts, which MP4 "reserve" fast start needs so it can
 * leave room for the index at the start of a streamed file. Video has one
 * packet per frame; audio packets are at least ~10 ms (per mediabunny's
 * guidance), and both get a 33% safety margin. Overestimating only wastes a
 * few kilobytes of reserved space; underestimating would fail the export.
 */
export function maximumPacketCounts(durationUs: number, fps: number) {
  const seconds = Math.max(0, durationUs) / 1_000_000;
  const margin = 4 / 3;
  return {
    video: Math.ceil((totalFrames(durationUs, fps) + 1) * margin),
    audio: Math.ceil((seconds * 100 + 1) * margin),
  };
}
