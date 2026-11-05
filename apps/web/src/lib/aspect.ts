/**
 * Frame shapes (aspect ratios) and the pixel sizes that follow from them. The
 * project stores only the shape; the preview draws at `compositionSize` and an
 * export at `frameSize` for its resolution (the short edge: "1080p" is 1080
 * pixels on the short side, whatever the shape).
 */
import type { AspectRatio, TimelineSnapshot } from '../engine/types';

export const ASPECTS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: '16:9', label: '16:9', hint: 'Widescreen: YouTube, TV' },
  { value: '9:16', label: '9:16', hint: 'Vertical: Shorts, Reels, TikTok' },
  { value: '1:1', label: '1:1', hint: 'Square' },
  { value: '4:5', label: '4:5', hint: 'Portrait: feed posts' },
];

export const DEFAULT_ASPECT: AspectRatio = '16:9';

export const aspectOf = (timeline: Pick<TimelineSnapshot, 'aspect'>): AspectRatio =>
  timeline.aspect ?? DEFAULT_ASPECT;

const RATIOS: Record<AspectRatio, [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
};

/**
 * The frame size with `shortEdge` pixels on its short side. Both sides are even
 * (video encoders need that).
 */
export function frameSize(
  aspect: AspectRatio,
  shortEdge: number,
): { width: number; height: number } {
  const [w, h] = RATIOS[aspect];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const long = even((shortEdge * Math.max(w, h)) / Math.min(w, h));
  const short = even(shortEdge);
  return w >= h ? { width: long, height: short } : { width: short, height: long };
}

/** The preview's drawing size: 1080 pixels on the short side, as 1080p export. */
export const compositionSize = (aspect: AspectRatio) => frameSize(aspect, 1080);

/**
 * The scale (percent) at which media of `sourceWidth`×`sourceHeight` covers
 * the whole frame instead of fitting inside it (cropping its edges): 100 when
 * the shapes match. Rounded up, so no sliver of background shows.
 */
export function fillScalePercent(
  sourceWidth: number,
  sourceHeight: number,
  aspect: AspectRatio,
): number {
  if (sourceWidth <= 0 || sourceHeight <= 0) return 100;
  const { width, height } = compositionSize(aspect);
  const fit = Math.min(width / sourceWidth, height / sourceHeight);
  const cover = Math.max(width / sourceWidth, height / sourceHeight);
  return Math.ceil((cover / fit) * 100 - 1e-9);
}
