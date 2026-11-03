import {
  ALL_FORMATS,
  BlobSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

/** An opened media file with its decodable tracks. Shared by every worker. */
export interface OpenedAsset {
  input: Input;
  /** Null if the file has no video track. */
  video: InputVideoTrack | null;
  /** Null if the file has no audio, or the browser can't decode it. */
  audio: InputAudioTrack | null;
  /** Container duration in microseconds. */
  durationUs: number;
}

export class UnsupportedMediaError extends Error {}

/**
 * Open a file and find its primary tracks. A video track the browser can't
 * decode is an error (the user would see a black clip); undecodable audio is
 * treated as no audio, so the video still imports.
 */
export async function openAsset(file: Blob): Promise<OpenedAsset> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const [video, audio] = await Promise.all([
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
  ]);
  if (video && !(await video.canDecode())) {
    throw new UnsupportedMediaError(
      `This browser cannot decode ${video.codec ?? 'this video codec'}`,
    );
  }
  const decodableAudio = audio && (await audio.canDecode()) ? audio : null;
  const durationUs = Math.round((await input.computeDuration()) * 1_000_000);
  return { input, video, audio: decodableAudio, durationUs };
}

export const toMicros = (seconds: number): number => Math.round(seconds * 1_000_000);
