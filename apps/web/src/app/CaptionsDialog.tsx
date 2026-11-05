import { useEffect, useRef } from 'react';
import { LANGUAGE_NAMES, SPEECH_LANGUAGES } from '../captions/languages';
import { CAPTION_MODELS, type CaptionModel, type CaptionStage } from '../captions/protocol';
import {
  cancelCaptions,
  closeCaptions,
  downloadMb,
  FELL_BACK,
  setCaptionOptions,
  startCaptions,
  useCaptions,
} from '../store/captions';

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
  const state = useCaptions();
  const {
    phase,
    stage,
    fraction,
    error,
    model,
    language,
    highlight,
    gpuAvailable,
    useGpu,
    fellBack,
  } = state;
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
            <span className="muted">(about {downloadMb(key, state)} MB, downloaded once)</span>
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
          {SPEECH_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
      </label>

      {gpuAvailable && (
        <label className="radio">
          <input
            type="checkbox"
            checked={useGpu}
            disabled={running}
            onChange={(e) => setCaptionOptions({ useGpu: e.target.checked })}
          />
          Use the graphics card{' '}
          <span className="muted">(usually much faster; a larger download)</span>
        </label>
      )}

      <label className="radio">
        <input
          type="checkbox"
          checked={highlight}
          disabled={running}
          onChange={(e) => setCaptionOptions({ highlight: e.target.checked })}
        />
        Highlight each word as it’s spoken
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
          {fellBack && <p className="muted inspector-tip">{FELL_BACK}</p>}
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
        <button type="submit" className="primary" disabled={running || gpuAvailable === null}>
          Create captions
        </button>
      </div>
    </form>
  );
}
