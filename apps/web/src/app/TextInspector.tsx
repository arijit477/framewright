import { useEffect, useMemo, useState } from 'react';
import {
  TEXT_LIMITS,
  type Clip,
  type FontFamily,
  type TextAlign,
  type TextAnimation,
  type TextContent,
  type TextStyle,
} from '../engine/types';
import { Debouncer } from '../lib/debouncer';
import { registerPendingEdits } from '../lib/pending-edits';
import { toSrt, toVtt, type CaptionCue } from '../captions/srt';
import { trackNames } from '../timeline/geometry';
import { openTranslation } from '../store/translation';
import {
  bilingualCaptions,
  CAPTION_HIGHLIGHT,
  captionPartners,
  selectedClip,
  trackCaptions,
  updateText,
  useEditor,
} from '../store/editor';

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
  // Flush when the panel closes, and whenever export/save needs the latest state.
  useEffect(() => {
    const unregister = registerPendingEdits(() => debouncer.flush());
    return () => {
      unregister();
      debouncer.flush();
    };
  }, [debouncer]);

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
        Size{' '}
        <span className="value" aria-hidden="true">
          {s.size}
        </span>
        <input
          type="range"
          aria-label="Size"
          aria-valuetext={`${s.size} pixels`}
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

      {(draft.words?.length ?? 0) > 0 && (
        <label className="field">
          Word highlight
          <span className="field-inline">
            <input
              type="checkbox"
              checked={s.highlight !== undefined}
              aria-label="Highlight each word as it’s spoken"
              onChange={(e) =>
                style(
                  { highlight: e.target.checked ? CAPTION_HIGHLIGHT : undefined },
                  { now: true },
                )
              }
            />
            {s.highlight !== undefined && (
              <input
                type="color"
                aria-label="Highlight colour"
                value={s.highlight}
                onChange={(e) => style({ highlight: e.target.value })}
                onBlur={flush}
              />
            )}
          </span>
        </label>
      )}

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
      <CaptionFiles clipId={clip.id} />
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

/** Save the titles on this clip's track as a captions file, for players and platforms. */
function CaptionFiles({ clipId }: { clipId: number }) {
  const trackId = useEditor(
    (s) => s.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId))?.id ?? null,
  );
  // Only edits change these (not playback), so work them out per timeline.
  const timeline = useEditor((s) => s.timeline);
  const partners = useMemo(
    () => (trackId === null ? [] : captionPartners(trackId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- captionPartners reads `timeline`
    [timeline, trackId],
  );
  const names = useMemo(() => trackNames(timeline), [timeline]);
  const [chosen, setChosen] = useState<number | null>(null);
  if (trackId === null) return null;
  const partner = chosen !== null && partners.includes(chosen) ? chosen : (partners[0] ?? null);

  const download = (captions: CaptionCue[], format: 'srt' | 'vtt', name: string) => {
    const text = format === 'srt' ? toSrt(captions) : toVtt(captions);
    const url = URL.createObjectURL(
      new Blob([text], { type: format === 'srt' ? 'application/x-subrip' : 'text/vtt' }),
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `${name}.${format}`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const save = (format: 'srt' | 'vtt') => download(trackCaptions(trackId), format, 'captions');
  const saveBoth = (format: 'srt' | 'vtt') =>
    partner !== null && download(bilingualCaptions(trackId, partner), format, 'captions-bilingual');

  return (
    <>
      <div className="field">
        This track’s captions
        <div className="lut-buttons">
          <button type="button" onClick={() => save('srt')}>
            Save as .srt
          </button>
          <button type="button" onClick={() => save('vtt')}>
            Save as .vtt
          </button>
          <button type="button" onClick={() => openTranslation(trackId)}>
            Translate…
          </button>
        </div>
      </div>
      {partner !== null && (
        <div className="field">
          <label className="field">
            Both languages in one file, with
            <select value={partner} onChange={(e) => setChosen(Number(e.target.value))}>
              {partners.map((id) => (
                <option key={id} value={id}>
                  {names.get(id) ?? `Track ${id}`}
                </option>
              ))}
            </select>
          </label>
          <div className="lut-buttons">
            <button type="button" onClick={() => saveBoth('srt')}>
              Save both as .srt
            </button>
            <button type="button" onClick={() => saveBoth('vtt')}>
              Save both as .vtt
            </button>
          </div>
        </div>
      )}
    </>
  );
}
