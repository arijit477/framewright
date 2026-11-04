import { TRANSITION_LIMITS, type Clip, type TransitionKind } from '../engine/types';
import { previousClip, setClipTransition, useEditor } from '../store/editor';

const KINDS: { value: TransitionKind | 'none'; label: string }[] = [
  { value: 'none', label: 'None (cut)' },
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'dip', label: 'Dip' },
  { value: 'slide', label: 'Slide' },
  { value: 'wipe', label: 'Wipe' },
];
const DURATIONS_MS = [250, 500, 1000, 1500, 2000, 3000];

/** The transition from the clip before this one (on the same track, touching it). */
export function TransitionField({ clip }: { clip: Clip }) {
  const timeline = useEditor((s) => s.timeline);
  const before = previousClip(clip, timeline);
  if (!before) {
    return (
      <div className="field">
        Transition
        <p className="muted inspector-tip">
          Place this clip right after another on the same track to add a transition.
        </p>
      </div>
    );
  }
  // A transition can't be longer than the clips either side of the cut.
  const maxMs = Math.min(
    TRANSITION_LIMITS.maxMs,
    Math.floor(Math.min(clip.duration, before.duration) / 1000),
  );
  const durations = DURATIONS_MS.filter((ms) => ms <= maxMs);
  const current = clip.transitionIn;

  return (
    <div className="field-row">
      <label className="field grow">
        Transition in
        <select
          value={current?.kind ?? 'none'}
          onChange={(e) => {
            const kind = e.target.value as TransitionKind | 'none';
            const durationMs = current?.durationMs ?? Math.min(500, maxMs);
            setClipTransition(clip.id, kind === 'none' ? null : { kind, durationMs });
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <label className="field">
          Length
          <select
            value={current.durationMs}
            onChange={(e) =>
              setClipTransition(clip.id, { ...current, durationMs: Number(e.target.value) })
            }
          >
            {[...new Set([...durations, current.durationMs])]
              .sort((a, b) => a - b)
              .map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} s
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );
}
