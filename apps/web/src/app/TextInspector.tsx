import { useEffect, useState } from 'react';
import {
  TEXT_LIMITS,
  type Clip,
  type FontFamily,
  type TextAlign,
  type TextAnimation,
  type TextContent,
  type TextStyle,
} from '../engine/types';
import { selectedClip, updateText, useEditor } from '../store/editor';

/** Typing and dragging sliders commit after this pause, so undo steps stay meaningful. */
const COMMIT_DELAY_MS = 500;

const FONTS: { value: FontFamily; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'handwriting', label: 'Handwriting' },
];
const ANIMATIONS: { value: TextAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'pop', label: 'Pop' },
];
const POSITIONS = [
  { label: 'Top', y: 150 },
  { label: 'Middle', y: 500 },
  { label: 'Bottom', y: 820 },
];

/** Edits the selected text clip. Remounted per clip, so drafts never leak between clips. */
export function TextInspector() {
  const clip = useEditor(selectedClip);
  if (!clip?.text) return null;
  return <Inspector key={clip.id} clip={clip} saved={clip.text} />;
}

function Inspector({ clip, saved }: { clip: Clip; saved: TextContent }) {
  const [draft, setDraft] = useState<TextContent>(saved);
  // Undo/redo can change the clip underneath us. Follow the saved value by
  // comparing during render (React's pattern for resetting state on a prop
  // change), keyed on content because the object is recreated on every refresh.
  const savedKey = JSON.stringify(saved);
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey);
    setDraft(saved);
  }

  // Pending commits live outside React state; each captures its exact value.
  const [debouncer] = useState(() => new Debouncer(COMMIT_DELAY_MS));
  useEffect(() => () => debouncer.flush(), [debouncer]); // flush when the panel closes

  const commit = (content: TextContent) => {
    if (content.text.trim()) updateText(clip.id, content); // no-op edits are ignored
  };

  /** Discrete choices apply at once; typing and sliders after a pause. */
  const change = (patch: Partial<TextContent>, { now = false } = {}) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (now) {
      debouncer.cancel();
      commit(next);
    } else {
      debouncer.schedule(() => commit(next));
    }
  };
  const style = (patch: Partial<TextStyle>, options?: { now?: boolean }) =>
    change({ style: { ...draft.style, ...patch } }, options);
  const flush = () => debouncer.flush();

  const s = draft.style;
  const empty = !draft.text.trim();

  return (
    <aside className="inspector" aria-label="Text">
      <h2>Text</h2>
      <label className="field">
        <span className="visually-hidden">Text content</span>
        <textarea
          value={draft.text}
          rows={3}
          maxLength={TEXT_LIMITS.maxChars}
          aria-label="Text content"
          aria-invalid={empty}
          onChange={(e) => change({ text: e.target.value })}
          onBlur={flush}
        />
      </label>
      {empty && <p className="field-hint">Text can’t be empty, so this change isn’t saved.</p>}

      <div className="field-row">
        <label className="field grow">
          Font
          <select
            value={s.font}
            onChange={(e) => style({ font: e.target.value as FontFamily }, { now: true })}
          >
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <Toggle label="Bold" pressed={s.bold} onChange={(bold) => style({ bold }, { now: true })}>
          B
        </Toggle>
        <Toggle
          label="Italic"
          pressed={s.italic}
          onChange={(italic) => style({ italic }, { now: true })}
        >
          <em>I</em>
        </Toggle>
      </div>

      <label className="field">
        Size <output>{s.size}</output>
        <input
          type="range"
          min={TEXT_LIMITS.minSize}
          max={160}
          value={Math.min(s.size, 160)}
          onChange={(e) => style({ size: Number(e.target.value) })}
          onPointerUp={flush}
        />
      </label>

      <div className="field-row">
        <label className="field">
          Colour
          <input
            type="color"
            value={s.color}
            onChange={(e) => style({ color: e.target.value })}
            onBlur={flush}
          />
        </label>
        <label className="field">
          Box
          <span className="field-inline">
            <input
              type="checkbox"
              checked={s.background !== null}
              aria-label="Background box"
              onChange={(e) =>
                style({ background: e.target.checked ? '#000000b3' : null }, { now: true })
              }
            />
            {s.background && (
              <input
                type="color"
                aria-label="Box colour"
                value={s.background.slice(0, 7)}
                onChange={(e) =>
                  style({ background: `${e.target.value}${s.background!.slice(7)}` })
                }
                onBlur={flush}
              />
            )}
          </span>
        </label>
      </div>

      <div className="field">
        Alignment
        <div className="segmented" role="group" aria-label="Alignment">
          {(['left', 'center', 'right'] as TextAlign[]).map((align) => (
            <button
              key={align}
              aria-pressed={s.align === align}
              className={s.align === align ? 'active' : ''}
              // Re-anchor so the text stays roughly where it was.
              onClick={() =>
                style(
                  { align, x: align === 'left' ? 100 : align === 'right' ? 900 : 500 },
                  { now: true },
                )
              }
            >
              {align[0]!.toUpperCase() + align.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        Position
        <div className="segmented" role="group" aria-label="Position">
          {POSITIONS.map((p) => (
            <button
              key={p.label}
              aria-pressed={s.y === p.y}
              className={s.y === p.y ? 'active' : ''}
              onClick={() => style({ y: p.y }, { now: true })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          aria-label="Vertical position"
          min={0}
          max={TEXT_LIMITS.positionScale}
          value={s.y}
          onChange={(e) => style({ y: Number(e.target.value) })}
          onPointerUp={flush}
        />
      </div>

      <div className="field-row">
        <label className="field grow">
          In
          <select
            value={s.animationIn}
            onChange={(e) => style({ animationIn: e.target.value as TextAnimation }, { now: true })}
          >
            {ANIMATIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          Out
          <select
            value={s.animationOut}
            onChange={(e) =>
              style({ animationOut: e.target.value as TextAnimation }, { now: true })
            }
          >
            {ANIMATIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </aside>
  );
}

function Toggle(props: {
  label: string;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`toggle ${props.pressed ? 'active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={() => props.onChange(!props.pressed)}
    >
      {props.children}
    </button>
  );
}

/** Runs the latest scheduled action after a pause; `flush` runs it now. */
class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: (() => void) | null = null;

  constructor(private readonly delayMs: number) {}

  schedule(action: () => void): void {
    this.pending = action;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    clearTimeout(this.timer);
    const action = this.pending;
    this.pending = null;
    action?.();
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.pending = null;
  }
}
