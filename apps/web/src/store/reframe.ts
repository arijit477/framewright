import { create } from 'zustand';
import { aspectOf, compositionSize, fillScalePercent } from '../lib/aspect';
import { flushPendingEdits } from '../lib/pending-edits';
import { ReframeJob } from '../reframe/client';
import { reframeKeyframes } from '../reframe/path';
import { assetFile, notify, setClipAnimation, useEditor } from './editor';

export interface ReframeState {
  /** The clip being analysed, or null. */
  clipId: number | null;
  fraction: number;
}

export const useReframe = create<ReframeState>(() => ({ clipId: null, fraction: 0 }));

const set = useReframe.setState;
let job: ReframeJob | null = null;

/**
 * Fill the frame with a clip and follow the faces in it: analyse its frames,
 * then replace its animation with a camera path (one undo step).
 */
export function startReframe(clipId: number): void {
  if (job) return;
  flushPendingEdits();
  const { timeline } = useEditor.getState();
  const clip = timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  const file = clip ? assetFile(clip.assetId) : null;
  if (!clip || !file) {
    notify('error', 'This clip’s media isn’t available, so it can’t be reframed.');
    return;
  }
  const sourceFrom = clip.sourceIn;
  const sourceTo = clip.sourceIn + Math.round((clip.duration * (clip.speedPercent ?? 100)) / 100);
  set({ clipId, fraction: 0 });
  job = new ReframeJob(
    { file, sourceFrom, sourceTo },
    {
      onProgress: (fraction) => set({ fraction }),
      onDone: (frames, size) => {
        job = null;
        set({ clipId: null });
        const found = frames.filter((f) => f.faces.length > 0).length;
        if (found === 0) {
          notify('info', 'No faces were found in this clip. Try “Fill frame” and drag it instead.');
          return;
        }
        const aspect = aspectOf(useEditor.getState().timeline);
        const keyframes = reframeKeyframes(
          frames,
          size,
          compositionSize(aspect),
          fillScalePercent(size.width, size.height, aspect),
        );
        if (setClipAnimation(clipId, keyframes)) {
          notify(
            'info',
            `Following faces: ${keyframes.length} keyframe${keyframes.length === 1 ? '' : 's'}.`,
          );
        }
      },
      onError: (message) => {
        job = null;
        set({ clipId: null });
        notify('error', `Reframing failed: ${message}`);
      },
    },
  );
}

export function cancelReframe(): void {
  job?.cancel();
  job = null;
  set({ clipId: null });
}
