import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SETTINGS,
  estimateBytes,
  exportFileName,
  formatBytes,
  formatSeconds,
  frameTimeUs,
  maximumPacketCounts,
  RESOLUTIONS,
  sanitizeSettings,
  totalFrames,
  videoBitrate,
  type ExportSettings,
} from './settings';

const settings = (s: Partial<ExportSettings> = {}): ExportSettings => ({
  ...DEFAULT_EXPORT_SETTINGS,
  ...s,
});

describe('frame timing', () => {
  it('counts the last partial frame', () => {
    expect(totalFrames(6_000_000, 30)).toBe(180);
    expect(totalFrames(6_010_000, 30)).toBe(181);
    expect(totalFrames(0, 30)).toBe(0);
  });

  it('is not tripped up by float noise', () => {
    expect(totalFrames(1_001_000 / 3, 3)).toBe(2); // 1.001 frames would be 2, not 1
    expect(totalFrames(2_000_000, 1)).toBe(2);
  });

  it('computes frame times from the index (no drift)', () => {
    expect(frameTimeUs(1, 30)).toBe(33_333);
    expect(frameTimeUs(30 * 3600, 30)).toBe(3_600_000_000);
  });
});

describe('bitrate', () => {
  it('scales with resolution, frame rate and quality', () => {
    const base = videoBitrate(settings());
    expect(videoBitrate(settings({ resolution: '720p' }))).toBeLessThan(base);
    expect(videoBitrate(settings({ fps: 60 }))).toBeGreaterThan(base);
    expect(videoBitrate(settings({ quality: 'low' }))).toBeLessThan(base);
  });

  it('is clamped to a sane range', () => {
    expect(
      videoBitrate(settings({ resolution: '480p', fps: 24, quality: 'low' })),
    ).toBeGreaterThanOrEqual(500_000);
    expect(videoBitrate(settings({ resolution: '2160p', fps: 60 }))).toBeLessThanOrEqual(
      80_000_000,
    );
  });

  it('uses even dimensions (required by H.264 4:2:0)', () => {
    for (const { width, height } of Object.values(RESOLUTIONS)) {
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });
});

describe('estimateBytes', () => {
  it('adds audio only when present', () => {
    const video = estimateBytes(10_000_000, settings(), false);
    expect(estimateBytes(10_000_000, settings(), true)).toBeGreaterThan(video);
    expect(video).toBe(Math.round((10 * videoBitrate(settings())) / 8));
  });
});

describe('exportFileName', () => {
  it('builds a safe, descriptive name', () => {
    expect(exportFileName('My Holiday Clip.MOV', settings())).toBe('my-holiday-clip-1080p30.mp4');
    expect(exportFileName('../../etc/passwd', settings({ format: 'webm' }))).toBe(
      'etcpasswd-1080p30.webm',
    );
  });

  it('falls back when nothing usable is left', () => {
    expect(exportFileName('???', settings())).toBe('framewright-export-1080p30.mp4');
  });
});

describe('formatting', () => {
  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSeconds(4.2)).toBe('5 s');
    expect(formatSeconds(125)).toBe('2 min 5 s');
    expect(formatSeconds(Infinity)).toBe('–');
  });
});

describe('sanitizeSettings', () => {
  it('keeps valid values and replaces unknown ones', () => {
    expect(
      sanitizeSettings({ format: 'webm', resolution: '720p', fps: 60, quality: 'low' }),
    ).toEqual({
      format: 'webm',
      resolution: '720p',
      fps: 60,
      quality: 'low',
    });
    expect(sanitizeSettings({ format: 'avi', resolution: '8k', fps: '30', quality: 1 })).toEqual(
      DEFAULT_EXPORT_SETTINGS,
    );
    expect(sanitizeSettings(null)).toEqual(DEFAULT_EXPORT_SETTINGS);
  });
});

describe('maximumPacketCounts', () => {
  it('bounds video by frame count and audio by 10 ms packets, with a margin', () => {
    const { video, audio } = maximumPacketCounts(6_000_000, 30);
    expect(video).toBeGreaterThanOrEqual(180);
    expect(video).toBeLessThan(260);
    // 48 kHz AAC (1024-sample packets) needs 282 for 6 s; Opus (20 ms) needs 300.
    expect(audio).toBeGreaterThanOrEqual(300 * 1.3);
  });

  it('never returns zero, even for empty timelines', () => {
    const { video, audio } = maximumPacketCounts(0, 30);
    expect(video).toBeGreaterThan(0);
    expect(audio).toBeGreaterThan(0);
  });
});
