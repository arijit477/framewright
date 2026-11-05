import { useEffect, useRef, useState } from 'react';
import { COLOR_LIMIT, type Clip, type ColorAdjust } from '../engine/types';
import { allSame } from '../lib/collections';
import { Debouncer } from '../lib/debouncer';
import { registerPendingEdits } from '../lib/pending-edits';
import { COLOR_PRESETS, isNeutral, NEUTRAL_COLOR, sameColor } from '../render/color';
import {
  importLut,
  setClipsColor,
  setClipsLut,
  setClipsLutIntensity,
  useEditor,
} from '../store/editor';
import { LutManager } from './LutManager';
import { Slider } from './TransformInspector';

const COMMIT_DELAY_MS = 400;
const colorOf = (clip: Clip): ColorAdjust => ({ ...NEUTRAL_COLOR, ...clip.color });

/**
 * Colour of the selected clips (with a picture): white balance, a LUT,
 * brightness, contrast and saturation, with ready-made looks. With several
 * clips, a change sets just that value on all of them, and values that differ
 * read "Mixed" (the main clip, the last one, is shown).
 */
export function ColorField({ clips }: { clips: readonly Clip[] }) {
  const ids = clips.map((c) => c.id);
  const main = clips.at(-1)!;
  const saved = colorOf(main);
  const [draft, setDraft] = useState<ColorAdjust>(saved);
  /** Values changed here but not yet committed (and so not "Mixed" any more). */
  const [touched, setTouched] = useState<Partial<ColorAdjust>>({});
  // Follow undo/redo and other changes (reset during render, keyed on content).
  const savedKey = JSON.stringify(clips.map(colorOf));
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setDraft(saved);
    setTouched({});
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
    setDraft({ ...draft, ...patch });
    const pending = { ...touched, ...patch };
    setTouched(pending);
    if (now) {
      debouncer.cancel();
      setClipsColor(ids, pending);
    } else {
      debouncer.schedule(() => setClipsColor(ids, pending));
    }
  };
  const flush = () => debouncer.flush();
  const mixed = (key: keyof ColorAdjust) =>
    !(key in touched) && !allSame(clips, (c) => colorOf(c)[key]);
  const slider = (label: string, key: keyof ColorAdjust) => (
    <Slider
      label={label}
      unit=""
      value={draft[key]}
      min={-COLOR_LIMIT}
      max={COLOR_LIMIT}
      mixed={mixed(key)}
      onChange={(v) => change({ [key]: v })}
      onCommit={flush}
    />
  );
  const everyClip = (check: (color: ColorAdjust) => boolean) =>
    clips.every((c) => check({ ...colorOf(c), ...touched }));

  return (
    <section className="inspector-section" aria-label="Color">
      <h2>{clips.length === 1 ? 'Color' : `Color (${clips.length} clips)`}</h2>
      {/* In processing order: white balance, then the LUT, then tone. */}
      {slider('Temperature', 'temperature')}
      {slider('Tint', 'tint')}
      <LutField clips={clips} />
      {slider('Brightness', 'brightness')}
      {slider('Contrast', 'contrast')}
      {slider('Saturation', 'saturation')}
      <div className="field">
        Looks
        <div className="pip-grid" role="group" aria-label="Color looks">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.name}
              aria-pressed={everyClip((color) => sameColor(preset.color, color))}
              onClick={() => change(preset.color, { now: true })}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => change(NEUTRAL_COLOR, { now: true })} disabled={everyClip(isNeutral)}>
        Reset color
      </button>
    </section>
  );
}

/**
 * Pick a project LUT for the clips (or load a `.cube` file), and how strongly
 * it applies. The LUT goes on before the tone sliders, so they fine-tune it.
 */
function LutField({ clips }: { clips: readonly Clip[] }) {
  const luts = useEditor((s) => s.luts);
  const fileInput = useRef<HTMLInputElement>(null);
  const [managing, setManaging] = useState(false);
  const ids = clips.map((c) => c.id);
  const main = clips.at(-1)!;
  const sameLut = allSame(clips, (c) => c.lut?.lutId ?? '');
  const current = main.lut;
  const withLut = clips.filter((c) => c.lut && luts[c.lut.lutId]);
  const choose = (lutId: string) =>
    setClipsLut(ids, lutId ? { lutId, intensityPercent: current?.intensityPercent ?? 100 } : null);
  // Files load at their own pace: only the most recently chosen one is applied
  // (an earlier, bigger file finishing later must not replace it). Each still
  // joins the project's LUTs.
  const latestLoad = useRef(0);
  const load = async (file: File | undefined) => {
    if (!file) return;
    const request = ++latestLoad.current;
    const id = await importLut(file);
    if (id && request === latestLoad.current)
      setClipsLut(ids, { lutId: id, intensityPercent: 100 });
  };

  const options = Object.values(luts).sort((a, b) => a.name.localeCompare(b.name));
  const missing = clips.some((c) => c.lut && !luts[c.lut.lutId]);
  return (
    <>
      <label className="field">
        LUT
        <select
          aria-label="LUT"
          value={!sameLut ? 'mixed' : current && luts[current.lutId] ? current.lutId : ''}
          onChange={(e) => choose(e.target.value)}
        >
          {!sameLut && (
            <option value="mixed" disabled>
              Mixed
            </option>
          )}
          <option value="">None</option>
          {options.map((lut) => (
            <option key={lut.id} value={lut.id}>
              {lut.name}
            </option>
          ))}
        </select>
      </label>
      {missing && (
        <p className="muted inspector-tip">
          {clips.length === 1 ? 'This clip’s LUT' : 'A selected clip’s LUT'} isn’t in the project
          any more.
        </p>
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
      {withLut.length > 0 && (
        // Keyed by the clips' LUTs, so the slider starts again from what they use after any
        // change (undo, a new LUT). Only the slider: the file input and the manager must stay
        // mounted, or a file chosen while a load finishes would be lost.
        <LutIntensity
          key={withLut.map((c) => `${c.id}:${c.lut!.lutId}:${c.lut!.intensityPercent}`).join()}
          clips={withLut}
        />
      )}
    </>
  );
}

/** How strongly the clips' LUTs apply (one value for all; "mixed" until moved). */
function LutIntensity({ clips }: { clips: readonly Clip[] }) {
  const [intensity, setIntensity] = useState(clips.at(-1)?.lut?.intensityPercent ?? 100);
  const [touched, setTouched] = useState(false);
  const mixed = !touched && !allSame(clips, (c) => c.lut!.intensityPercent);
  const commit = () => {
    if (touched && clips.some((c) => c.lut!.intensityPercent !== intensity)) {
      setClipsLutIntensity(
        clips.map((c) => c.id),
        intensity,
      );
    }
  };
  return (
    <Slider
      label="LUT intensity"
      unit="%"
      value={intensity}
      min={0}
      max={100}
      mixed={mixed}
      onChange={(v) => {
        setTouched(true);
        setIntensity(v);
      }}
      onCommit={commit}
    />
  );
}
