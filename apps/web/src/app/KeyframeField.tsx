import type { Clip, Easing } from '../engine/types';
import { adjacentKeyframe, keyframeAt, visibleKeyframes } from '../lib/keyframes';
import {
  clearKeyframes,
  seekToKeyframe,
  setKeyframeEasing,
  toggleKeyframe,
  useEditor,
} from '../store/editor';

const EASINGS: { value: Easing; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in and out' },
];

/**
 * Animate a clip's transform: add a keyframe at the playhead, change the
 * sliders at another moment (which keyframes them there), and the clip moves
 * between them. `flush` commits any slider change still being debounced first.
 */
export function KeyframeField({ clip, flush }: { clip: Clip; flush: () => void }) {
  const playhead = useEditor((s) => s.playhead);
  const keys = visibleKeyframes(clip);
  const current = keyframeAt(clip, playhead);
  const previous = adjacentKeyframe(clip, playhead, -1);
  const next = adjacentKeyframe(clip, playhead, 1);
  const run = (action: () => void) => () => {
    flush();
    action();
  };

  return (
    <div className="field keyframes">
      <span>
        Keyframes{' '}
        <span className="value" aria-hidden="true">
          {keys.length > 0 ? keys.length : ''}
        </span>
      </span>
      <div className="keyframe-row" role="group" aria-label="Keyframes">
        <button
          onClick={run(() => seekToKeyframe(clip.id, -1))}
          disabled={!previous}
          aria-label="Previous keyframe"
          title="Previous keyframe"
        >
          ◀
        </button>
        <button
          className="keyframe-toggle"
          onClick={run(() => toggleKeyframe(clip.id))}
          aria-pressed={current !== null}
        >
          <span aria-hidden="true">◆ </span>
          {current ? 'Remove keyframe' : 'Add keyframe'}
        </button>
        <button
          onClick={run(() => seekToKeyframe(clip.id, 1))}
          disabled={!next}
          aria-label="Next keyframe"
          title="Next keyframe"
        >
          ▶
        </button>
      </div>
      {current && (
        <label className="field">
          Easing to the next keyframe
          <select
            value={current.easing}
            onChange={(e) =>
              setKeyframeEasing(clip.id, current.sourceTime, e.target.value as Easing)
            }
          >
            {EASINGS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(clip.keyframes?.length ?? 0) > 0 ? (
        <button onClick={run(() => clearKeyframes(clip.id))}>Remove all keyframes</button>
      ) : (
        <p className="muted inspector-tip">
          Add a keyframe, move the playhead, then change the clip: it animates between them.
        </p>
      )}
    </div>
  );
}
