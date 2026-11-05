import { useEffect, useRef } from 'react';
import { LANGUAGE_NAMES } from '../captions/languages';
import {
  PIVOT,
  routeDownloadMb,
  sourceLanguages,
  targetLanguages,
  translationRoute,
  type TranslationStage,
} from '../captions/translation';
import {
  cancelTranslation,
  closeTranslation,
  setTranslationLanguages,
  startTranslation,
  useTranslation,
} from '../store/translation';

const STAGES: Record<TranslationStage, string> = {
  model: 'Downloading the translation model (only the first time)',
  translate: 'Translating',
};

/** Translate a caption track into another language, on this device. */
export function TranslateDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useTranslation((s) => s.open);
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
      aria-labelledby="translate-title"
      onCancel={(e) => {
        e.preventDefault();
        closeTranslation();
      }}
    >
      {open && <TranslateBody />}
    </dialog>
  );
}

function TranslateBody() {
  const { phase, stage, fraction, step, steps, error, from, to } = useTranslation();
  const running = phase === 'running';
  const route = translationRoute(from, to);
  return (
    <form
      className="export-body captions-form"
      onSubmit={(e) => {
        e.preventDefault();
        startTranslation();
      }}
    >
      <h2 id="translate-title">Translate captions</h2>
      <p className="muted">
        Adds a translated copy of this caption track on a new track, at the same times and in the
        same style, which you can then edit. It runs on this device.
      </p>

      <div className="field-row">
        <label className="field grow">
          From
          <select
            value={from}
            disabled={running}
            onChange={(e) => setTranslationLanguages({ from: e.target.value })}
          >
            {sourceLanguages().map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          Into
          <select
            value={to}
            disabled={running}
            onChange={(e) => setTranslationLanguages({ to: e.target.value })}
          >
            {targetLanguages(from).map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {route && (
        <p className="muted inspector-tip" data-testid="translation-route">
          {route.length > 1 ? `Goes through ${LANGUAGE_NAMES[PIVOT]} (two models). ` : ''}
          About {routeDownloadMb(route)} MB, downloaded once and then kept by the browser.
          Translation models: OPUS-MT by Helsinki-NLP (open source).
        </p>
      )}

      {running && (
        <div>
          <progress max={1} value={fraction} aria-label="Translation progress" />
          <p className="export-stats">
            <span>{Math.floor(fraction * 100)}%</span>
            <span className="muted">
              {STAGES[stage]}
              {steps > 1 ? ` (step ${step} of ${steps})` : ''}…
            </span>
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
          <button type="button" onClick={cancelTranslation}>
            Cancel
          </button>
        ) : (
          <button type="button" onClick={closeTranslation}>
            Close
          </button>
        )}
        <button type="submit" className="primary" disabled={running || !route}>
          Translate
        </button>
      </div>
    </form>
  );
}
