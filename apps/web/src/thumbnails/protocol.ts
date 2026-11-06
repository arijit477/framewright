export type ToThumbnailWorker =
  /** `job` is echoed in every reply, so replies to a replaced request can be ignored. */
  | { type: 'generate'; id: string; job: number; file: Blob }
  /**
   * Finer thumbnails for part of an asset (zoomed in): one per source time, at
   * the base strip's size. Replaces this asset's earlier detail request if it
   * hasn't started.
   */
  | {
      type: 'detail';
      id: string;
      job: number;
      file: Blob;
      /** The detail level (echoed in the reply, so replies to older requests are filed right). */
      spacingUs: number;
      timesUs: number[];
      width: number;
      height: number;
    }
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
  | {
      type: 'detailThumbs';
      id: string;
      job: number;
      spacingUs: number;
      items: { timeUs: number; bitmap: ImageBitmap }[];
    }
  | { type: 'error'; id: string; job: number; message: string };
