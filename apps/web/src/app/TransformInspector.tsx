import { useEffect, useState } from 'react';
import { IDENTITY_TRANSFORM, type Clip, type Transform } from '../engine/types';
import { Debouncer } from '../lib/debouncer';
import { registerPendingEdits } from '../lib/pending-edits';
import { TransitionField } from './TransitionField';
import { setClipTransform } from '../store/editor';

const COMMIT_DELAY_MS = 400;

/** Picture-in-picture: 35% size, inset from a corner (positions are clip centres). */
const PIP_SCALE = 35;
const PIP_NEAR = 215;
const PIP_FAR = 785;
const PIP_PRESETS = [
  { label: 'Top left', x: PIP_NEAR, y: PIP_NEAR },
  { label: 'Top right', x: PIP_FAR, y: PIP_NEAR },
  { label: 'Bottom left', x: PIP_NEAR, y: PIP_FAR },
  { label: 'Bottom right', x: PIP_FAR, y: PIP_FAR },
];

/** Position, scale, rotation and opacity of a media clip. */
export function TransformInspector({ clip }: { clip: Clip }) {
  const saved = clip.transform ?? IDENTITY_TRANSFORM;
  const [draft, setDraft] = useState<Transform>(saved);
  // Follow undo/redo and on-preview drags (reset during render, keyed on content).
  const savedKey = JSON.stringify(saved);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setDraft(saved);
  }

  const [debouncer] = useState(() => new Debouncer(COMMIT_DELAY_MS));
  // Flush when the panel closes, and whenever export/save needs the latest state.
  useEffect(() => {
    const unregister = registerPendingEdits(() => debouncer.flush());
    return () => {
      unregister();
      debouncer.flush();
    };
  }, [debouncer]);

  const change = (patch: Partial<Transform>, { now = false } = {}) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (now) {
      debouncer.cancel();
      setClipTransform(clip.id, next);
    } else {
      debouncer.schedule(() => setClipTransform(clip.id, next));
    }
  };
  const flush = () => debouncer.flush();

  return (
    <aside className="inspector" aria-label="Transform">
      <h2>Transform</h2>
      <Slider
        label="Position X"
        unit="%"
        value={draft.x / 10}
        min={0}
        max={100}
        step={0.5}
        onChange={(v) => change({ x: Math.round(v * 10) })}
        onCommit={flush}
      />
      <Slider
        label="Position Y"
        unit="%"
        value={draft.y / 10}
        min={0}
        max={100}
        step={0.5}
        onChange={(v) => change({ y: Math.round(v * 10) })}
        onCommit={flush}
      />
      <Slider
        label="Scale"
        unit="%"
        value={draft.scalePercent}
        min={10}
        max={400}
        onChange={(v) => change({ scalePercent: v })}
        onCommit={flush}
      />
      <Slider
        label="Rotation"
        unit="°"
        value={draft.rotationDeg}
        min={-180}
        max={180}
        onChange={(v) => change({ rotationDeg: v })}
        onCommit={flush}
      />
      <Slider
        label="Opacity"
        unit="%"
        value={draft.opacityPercent}
        min={0}
        max={100}
        onChange={(v) => change({ opacityPercent: v })}
        onCommit={flush}
      />

      <div className="field">
        Picture in picture
        <div className="pip-grid" role="group" aria-label="Picture in picture">
          {PIP_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => change({ ...p, scalePercent: PIP_SCALE }, { now: true })}
              aria-label={`Picture in picture, ${p.label.toLowerCase()}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TransitionField clip={clip} />

      <button
        onClick={() => change(IDENTITY_TRANSFORM, { now: true })}
        disabled={savedKey === JSON.stringify(IDENTITY_TRANSFORM)}
      >
        Reset
      </button>
      <p className="muted inspector-tip">Tip: drag the clip in the preview to move it.</p>
    </aside>
  );
}

function Slider(props: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="field">
      <span>
        {props.label}{' '}
        {/* A plain readout: the slider itself announces the value (aria-valuetext). */}
        <span className="value" aria-hidden="true">
          {format(props.value)}
          {props.unit}
        </span>
      </span>
      <input
        type="range"
        aria-label={props.label}
        aria-valuetext={`${format(props.value)}${props.unit}`}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={Math.min(props.max, Math.max(props.min, props.value))}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onCommit}
        onKeyUp={props.onCommit}
        onBlur={props.onCommit}
      />
    </label>
  );
}

const format = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
