import { useEffect, useRef, useState } from 'react';
import { COLOR_LIMIT, type Clip, type ColorAdjust } from '../engine/types';
import { Debouncer } from '../lib/debouncer';
import { registerPendingEdits } from '../lib/pending-edits';
import { COLOR_PRESETS, isNeutral, NEUTRAL_COLOR, sameColor } from '../render/color';
import { importLut, setClipColor, setClipLut, useEditor } from '../store/editor';
import { LutManager } from './LutManager';
import { Slider } from './TransformInspector';

const COMMIT_DELAY_MS = 400;

/**
 * Colour of a media clip: white balance, a LUT, brightness, contrast and
 * saturation, with ready-made looks.
 */
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
      {/* In processing order: white balance, then the LUT, then tone. */}
      {slider('Temperature', 'temperature')}
      {slider('Tint', 'tint')}
      <LutField key={`${clip.id}:${clip.lut?.lutId}:${clip.lut?.intensityPercent}`} clip={clip} />
      {slider('Brightness', 'brightness')}
      {slider('Contrast', 'contrast')}
      {slider('Saturation', 'saturation')}
      <div className="field">
        Looks
        <div className="pip-grid" role="group" aria-label="Color looks">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.name}
              aria-pressed={sameColor(preset.color, draft)}
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

/**
 * Pick a project LUT for the clip (or load a `.cube` file), and how strongly
 * it applies. The LUT goes on before the sliders above, so they fine-tune it.
 */
function LutField({ clip }: { clip: Clip }) {
  const luts = useEditor((s) => s.luts);
  const fileInput = useRef<HTMLInputElement>(null);
  const [managing, setManaging] = useState(false);
  const current = clip.lut;
  const [intensity, setIntensity] = useState(current?.intensityPercent ?? 100);
  const commitIntensity = () => {
    if (current && intensity !== current.intensityPercent) {
      setClipLut(clip.id, { lutId: current.lutId, intensityPercent: intensity });
    }
  };
  const choose = (lutId: string) =>
    setClipLut(
      clip.id,
      lutId ? { lutId, intensityPercent: current?.intensityPercent ?? 100 } : null,
    );
  const load = async (file: File | undefined) => {
    if (!file) return;
    const id = await importLut(file);
    if (id) setClipLut(clip.id, { lutId: id, intensityPercent: 100 });
  };

  const options = Object.values(luts).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <label className="field">
        LUT
        <select
          aria-label="LUT"
          value={current && luts[current.lutId] ? current.lutId : ''}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">None</option>
          {options.map((lut) => (
            <option key={lut.id} value={lut.id}>
              {lut.name}
            </option>
          ))}
        </select>
      </label>
      {current && !luts[current.lutId] && (
        <p className="muted inspector-tip">This clip’s LUT isn’t in the project any more.</p>
      )}
      <div className="lut-buttons">
        <button onClick={() => fileInput.current?.click()}>Load .cube file…</button>
        <button onClick={() => setManaging(true)} disabled={options.length === 0}>
          Manage LUTs…
        </button>
      </div>
      <LutManager open={managing} onClose={() => setManaging(false)} />
      <input
        ref={fileInput}
        type="file"
        accept=".cube"
        hidden
        aria-label="LUT file"
        onChange={(e) => {
          void load(e.target.files?.[0]);
          e.target.value = ''; // the same file can be chosen again
        }}
      />
      {current && luts[current.lutId] && (
        <Slider
          label="LUT intensity"
          unit="%"
          value={intensity}
          min={0}
          max={100}
          onChange={setIntensity}
          onCommit={commitIntensity}
        />
      )}
    </>
  );
}
