import { describe, expect, it } from 'vitest';
import { aspectOf, compositionSize, fillScalePercent, frameSize } from './aspect';

describe('frame sizes', () => {
  it('keeps the short edge at the resolution, whatever the shape', () => {
    expect(frameSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(frameSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(frameSize('1:1', 1080)).toEqual({ width: 1080, height: 1080 });
    expect(frameSize('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
    expect(frameSize('16:9', 2160)).toEqual({ width: 3840, height: 2160 });
    expect(frameSize('9:16', 720)).toEqual({ width: 720, height: 1280 });
  });

  it('makes both sides even, as encoders need', () => {
    // 480p 16:9 is 853.3 wide: rounded to an even 854, as before.
    expect(frameSize('16:9', 480)).toEqual({ width: 854, height: 480 });
    expect(frameSize('9:16', 480)).toEqual({ width: 480, height: 854 });
    for (const shape of ['16:9', '9:16', '1:1', '4:5'] as const) {
      for (const edge of [480, 720, 1080, 1440, 2160]) {
        const { width, height } = frameSize(shape, edge);
        expect(width % 2, `${shape} ${edge}`).toBe(0);
        expect(height % 2, `${shape} ${edge}`).toBe(0);
      }
    }
  });

  it('draws the preview like a 1080p export', () => {
    expect(compositionSize('9:16')).toEqual({ width: 1080, height: 1920 });
  });

  it('treats projects without a shape as widescreen', () => {
    expect(aspectOf({})).toBe('16:9');
    expect(aspectOf({ aspect: '1:1' })).toBe('1:1');
  });
});

describe('fillScalePercent', () => {
  it('is 100% when the media already has the frame’s shape', () => {
    expect(fillScalePercent(1920, 1080, '16:9')).toBe(100);
    expect(fillScalePercent(1080, 1920, '9:16')).toBe(100);
  });

  it('scales widescreen video up to cover a vertical frame', () => {
    // Fitted, it's 1080 wide and 608 high; covering needs 1920 high: ×3.16.
    expect(fillScalePercent(1920, 1080, '9:16')).toBe(317);
    expect(fillScalePercent(1920, 1080, '1:1')).toBe(178);
    expect(fillScalePercent(1080, 1920, '16:9')).toBe(317);
  });

  it('covers the frame exactly: no background shows at that scale', () => {
    for (const aspect of ['16:9', '9:16', '1:1', '4:5'] as const) {
      const { width, height } = compositionSize(aspect);
      for (const [w, h] of [
        [1920, 1080],
        [1080, 1920],
        [640, 480],
      ] as const) {
        const scale = fillScalePercent(w, h, aspect) / 100;
        const fit = Math.min(width / w, height / h);
        expect(w * fit * scale, `${w}x${h} in ${aspect}`).toBeGreaterThanOrEqual(width - 1e-6);
        expect(h * fit * scale, `${w}x${h} in ${aspect}`).toBeGreaterThanOrEqual(height - 1e-6);
      }
    }
  });
});
