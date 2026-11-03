import type { AudioSegment } from '../engine/types';
import type { RingBuffers } from './ring-buffer';

/** Waveform resolution: one peak value per bucket. */
export const PEAKS_PER_SECOND = 100;

export type ToAudioWorker =
  | { type: 'init'; buffers: RingBuffers; sampleRate: number }
  | { type: 'addAsset'; id: string; file: File }
  | { type: 'start'; epoch: number; fromUs: number; segments: AudioSegment[] }
  | { type: 'update'; epoch: number; segments: AudioSegment[] }
  | { type: 'stop' };

export type FromAudioWorker =
  | { type: 'assetReady'; id: string; hasAudio: boolean; durationUs: number }
  | { type: 'assetError'; id: string; message: string }
  | { type: 'peaks'; id: string; peaks: Float32Array }
  | { type: 'error'; message: string };
