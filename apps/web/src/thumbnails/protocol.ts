export type ToThumbnailWorker =
  /** `job` is echoed in every reply, so replies to a replaced request can be ignored. */
  | { type: 'generate'; id: string; job: number; file: Blob }
  /** Cancel everything and forget all assets (switching projects). */
  | { type: 'clear' };

export type FromThumbnailWorker =
  | {
      type: 'plan';
      id: string;
      job: number;
      intervalUs: number;
      count: number;
      width: number;
      height: number;
    }
  | { type: 'thumbs'; id: string; job: number; items: { index: number; bitmap: ImageBitmap }[] }
  | { type: 'done'; id: string; job: number }
  | { type: 'error'; id: string; job: number; message: string };
