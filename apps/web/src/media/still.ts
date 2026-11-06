/**
 * Still images (PNG, JPEG, WebP, GIF, AVIF, BMP) as clips: one picture for
 * every moment of the clip, decoded once. Drawn through the same paths as
 * video (a `VideoSample` from the bitmap), so transforms, colour, LUTs,
 * background removal and reframing all apply.
 */
import { VideoSample } from 'mediabunny';
import type { SampleReader } from '../render/frame-reader';

const STILL_TYPES = /^image\/(png|jpeg|webp|gif|avif|bmp)$/;
const STILL_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

export const isStillFile = (file: Blob & { name?: string }): boolean =>
  STILL_TYPES.test(file.type) || STILL_EXTENSIONS.test(file.name ?? '');

/** How long a still lasts when added (it can be trimmed to any length). */
export const STILL_DURATION_US = 5_000_000;

/** Decode a still (EXIF orientation applied, as cameras intend). */
export async function decodeStill(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('this image couldn’t be read');
  }
}

/** The same picture at every time. The bitmap belongs to whoever decoded it. */
export class StillReader implements SampleReader {
  private readonly sample: VideoSample;

  constructor(bitmap: ImageBitmap) {
    this.sample = new VideoSample(bitmap, { timestamp: 0 });
  }

  async frameAt(): Promise<VideoSample> {
    return this.sample;
  }

  async dispose(): Promise<void> {
    this.sample.close();
  }
}
