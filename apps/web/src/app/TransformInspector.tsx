import { useEffect, useState } from 'react';
import { IDENTITY_TRANSFORM, type Clip, type Transform } from '../engine/types';
import { aspectOf, fillScalePercent } from '../lib/aspect';
import { cancelReframe, startReframe, useReframe } from '../store/reframe';
import { Debouncer } from '../lib/debouncer';
import { roundTransform } from '../lib/keyframes';
import { registerPendingEdits } from '../lib/pending-edits';
import { KeyframeField } from './KeyframeField';
import { TransitionField } from './TransitionField';
import { clipTransformAt, resetTransform, setClipTransform, useEditor } from '../store/editor';

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

/**
 * Position, scale, rotation and opacity of a media clip. Once the clip has
 * keyframes, the sliders show (and change) its look at the playhead.
 */
export function TransformInspector({ clip }: { clip: Clip }) {
  const animated = (clip.keyframes?.length ?? 0) > 0;
  const reframing = useReframe((s) => s.clipId === clip.id);
  const reframeProgress = useReframe((s) => s.fraction);
  // The scale at which this clip covers the frame (100 when its shape matches).
  // Following faces analyses video frames; a still image only needs "Fill frame".
  const isStill = useEditor((s) => s.assets[clip.assetId]?.still === true);
  const fill = useEditor((s) => {
    const asset = s.assets[clip.assetId];
    return asset?.hasVideo
      ? fillScalePercent(asset.width, asset.height, aspectOf(s.timeline))
      : 100;
  });
  // Only follow the playhead when it matters, so playback doesn't re-render the panel otherwise.
  const playhead = useEditor((s) => (animated ? s.playhead : 0));
  const saved = animated
    ? roundTransform(clipTransformAt(clip.id, playhead))
    : (clip.transform ?? IDENTITY_TRANSFORM);
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
    // Keyframed at the moment of the change, even if the playhead moves before the commit.
    const at = useEditor.getState().playhead;
    if (now) {
      debouncer.cancel();
      setClipTransform(clip.id, next, at);
    } else {
      debouncer.schedule(() => setClipTransform(clip.id, next, at));
    }
  };
  const flush = () => debouncer.flush();

  return (
    <>
      <section className="inspector-section" aria-label="Transform">
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

        <KeyframeField clip={clip} flush={flush} />

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

        {fill !== 100 && (
          <div className="lut-buttons">
            <button
              onClick={() =>
                change({ x: 500, y: 500, scalePercent: fill, rotationDeg: 0 }, { now: true })
              }
              title="Scale the clip up until it covers the frame, cropping its edges"
            >
              Fill frame
            </button>
            {isStill ? null : reframing ? (
              <button onClick={cancelReframe}>
                Finding faces… {Math.floor(reframeProgress * 100)}% (cancel)
              </button>
            ) : (
              <button
                onClick={() => {
                  debouncer.flush();
                  startReframe(clip.id);
                }}
                title="Fill the frame and follow the faces in the clip with keyframes (replaces its animation)"
              >
                Fill and follow faces
              </button>
            )}
          </div>
        )}
        <button
          onClick={() => {
            debouncer.cancel();
            resetTransform(clip.id);
          }}
          disabled={!animated && savedKey === JSON.stringify(IDENTITY_TRANSFORM)}
          title={animated ? 'Reset the transform and remove all keyframes' : undefined}
        >
          Reset transform
        </button>
        <p className="muted inspector-tip">Tip: drag the clip in the preview to move it.</p>
      </section>
    </>
  );
}

export function Slider(props: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** The selected clips differ: show "Mixed" (the thumb sits at the main clip's value). */
  mixed?: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const readout = props.mixed ? 'Mixed' : `${format(props.value)}${props.unit}`;
  return (
    <label className="field">
      <span>
        {props.label}{' '}
        {/* A plain readout: the slider itself announces the value (aria-valuetext). */}
        <span className="value" aria-hidden="true">
          {readout}
        </span>
      </span>
      <input
        type="range"
        aria-label={props.label}
        aria-valuetext={readout}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
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
