import { useEffect, useState } from 'react';
import { COLOR_LIMIT, type Clip, type ColorAdjust } from '../engine/types';
import { Debouncer } from '../lib/debouncer';
import { registerPendingEdits } from '../lib/pending-edits';
import { COLOR_PRESETS, isNeutral, NEUTRAL_COLOR } from '../render/color';
import { setClipColor } from '../store/editor';
import { Slider } from './TransformInspector';

const COMMIT_DELAY_MS = 400;

/** Brightness, contrast and saturation of a media clip, with ready-made looks. */
export function ColorField({ clip }: { clip: Clip }) {
  const saved = clip.color ?? NEUTRAL_COLOR;
  const [draft, setDraft] = useState<ColorAdjust>(saved);
  // Follow undo/redo (reset during render, keyed on content).
  const savedKey = JSON.stringify(saved);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setDraft(saved);
  }

  const [debouncer] = useState(() => new Debouncer(COMMIT_DELAY_MS));
  useEffect(() => {
    const unregister = registerPendingEdits(() => debouncer.flush());
    return () => {
      unregister();
      debouncer.flush();
    };
  }, [debouncer]);

  const change = (patch: Partial<ColorAdjust>, { now = false } = {}) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (now) {
      debouncer.cancel();
      setClipColor(clip.id, next);
    } else {
      debouncer.schedule(() => setClipColor(clip.id, next));
    }
  };
  const flush = () => debouncer.flush();
  const slider = (label: string, key: keyof ColorAdjust) => (
    <Slider
      label={label}
      unit=""
      value={draft[key]}
      min={-COLOR_LIMIT}
      max={COLOR_LIMIT}
      onChange={(v) => change({ [key]: v })}
      onCommit={flush}
    />
  );

  return (
    <section className="inspector-section" aria-label="Color">
      <h2>Color</h2>
      {slider('Brightness', 'brightness')}
      {slider('Contrast', 'contrast')}
      {slider('Saturation', 'saturation')}
      <div className="field">
        Looks
        <div className="pip-grid" role="group" aria-label="Color looks">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.name}
              aria-pressed={JSON.stringify(preset.color) === JSON.stringify(draft)}
              onClick={() => change(preset.color, { now: true })}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => change(NEUTRAL_COLOR, { now: true })} disabled={isNeutral(draft)}>
        Reset color
      </button>
    </section>
  );
}
