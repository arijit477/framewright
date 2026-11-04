import { useEffect, useRef } from 'react';
import { CAPTION_MODELS, type CaptionModel, type CaptionStage } from '../captions/protocol';
import {
  cancelCaptions,
  closeCaptions,
  setCaptionOptions,
  startCaptions,
  useCaptions,
} from '../store/captions';

/** Languages offered by name; Whisper understands many more when detecting. */
const LANGUAGES: [code: string, name: string][] = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['bn', 'Bengali'],
  ['ur', 'Urdu'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['mr', 'Marathi'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['ar', 'Arabic'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
];

const STAGES: Record<CaptionStage, string> = {
  audio: 'Preparing the sound',
  model: 'Downloading the speech model (only the first time)',
  speech: 'Recognising speech',
};

/** Auto captions: pick a model and language, then follow the run. */
export function CaptionsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useCaptions((s) => s.open);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="export-dialog"
      aria-labelledby="captions-title"
      onCancel={(e) => {
        e.preventDefault();
        closeCaptions();
      }}
    >
      {open && <CaptionsBody />}
    </dialog>
  );
}

function CaptionsBody() {
  const { phase, stage, fraction, error, model, language } = useCaptions();
  const running = phase === 'running';
  return (
    <form
      className="export-body captions-form"
      onSubmit={(e) => {
        e.preventDefault();
        startCaptions();
      }}
    >
      <h2 id="captions-title">Auto captions</h2>
      <p className="muted">
        Turns the speech in your project into captions on a new track, which you can then edit like
        any title. It runs on this device: your audio never leaves it.
      </p>

      <fieldset className="field" disabled={running}>
        <legend>Speech model</legend>
        {(Object.keys(CAPTION_MODELS) as CaptionModel[]).map((key) => (
          <label key={key} className="radio">
            <input
              type="radio"
              name="model"
              checked={model === key}
              onChange={() => setCaptionOptions({ model: key })}
            />
            {CAPTION_MODELS[key].label}{' '}
            <span className="muted">
              (about {CAPTION_MODELS[key].downloadMb} MB, downloaded once)
            </span>
          </label>
        ))}
      </fieldset>

      <label className="field">
        Language
        <select
          value={language ?? ''}
          disabled={running}
          onChange={(e) => setCaptionOptions({ language: e.target.value || null })}
        >
          <option value="">Detect automatically</option>
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <p className="muted inspector-tip">
        The model (OpenAI’s Whisper, open source) comes from Hugging Face the first time and is then
        kept by the browser, so later runs work offline.
      </p>

      {running && (
        <div>
          <progress max={1} value={fraction} aria-label="Captions progress" />
          <p className="export-stats">
            <span>{Math.floor(fraction * 100)}%</span>
            <span className="muted">{STAGES[stage]}…</span>
          </p>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="export-actions">
        {running ? (
          <button type="button" onClick={cancelCaptions}>
            Cancel
          </button>
        ) : (
          <button type="button" onClick={closeCaptions}>
            Close
          </button>
        )}
        <button type="submit" className="primary" disabled={running}>
          Create captions
        </button>
      </div>
    </form>
  );
}
