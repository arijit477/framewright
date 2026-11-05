import { useEffect, useRef } from 'react';
import {
  cancelSilence,
  closeSilence,
  resetSilenceOptions,
  setSilenceOptions,
  startSilence,
  useSilence,
} from '../store/silence';
import { Slider } from './TransformInspector';

/** Find the pauses in the selected clips' sound and cut them out. */
export function SilenceDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useSilence((s) => s.open);
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
      aria-labelledby="silence-title"
      onCancel={(e) => {
        e.preventDefault();
        closeSilence();
      }}
    >
      {open && <SilenceBody />}
    </dialog>
  );
}

function SilenceBody() {
  const { phase, fraction, error, options, clipIds } = useSilence();
  const running = phase === 'running';
  const seconds = (us: number) => Math.round(us / 10_000) / 100;
  return (
    <form
      className="export-body captions-form"
      onSubmit={(e) => {
        e.preventDefault();
        startSilence();
      }}
    >
      <h2 id="silence-title">Remove silences</h2>
      <p className="muted">
        Cuts the pauses out of {clipIds.length === 1 ? 'the selected clip' : 'the selected clips'}{' '}
        and closes the gaps on {clipIds.length === 1 ? 'its track' : 'their tracks'}. Other tracks
        don’t move, so do this before adding captions or music. One undo brings it all back.
      </p>

      <fieldset className="field" disabled={running}>
        <legend className="visually-hidden">Settings</legend>
        <Slider
          label="Quieter than"
          unit=" dB"
          value={options.thresholdDb}
          min={-60}
          max={-20}
          onChange={(thresholdDb) => setSilenceOptions({ thresholdDb })}
          onCommit={() => {}}
        />
        <Slider
          label="Pauses longer than"
          unit=" s"
          value={seconds(options.minSilenceUs)}
          min={0.2}
          max={3}
          step={0.1}
          onChange={(s) => setSilenceOptions({ minSilenceUs: Math.round(s * 1e6) })}
          onCommit={() => {}}
        />
        <Slider
          label="Keep around speech"
          unit=" ms"
          value={Math.round(options.marginUs / 1000)}
          min={0}
          max={500}
          step={10}
          onChange={(ms) => setSilenceOptions({ marginUs: ms * 1000 })}
          onCommit={() => {}}
        />
        <button type="button" onClick={resetSilenceOptions}>
          Reset to defaults
        </button>
      </fieldset>

      {running && (
        <div>
          <progress max={1} value={fraction} aria-label="Silence analysis progress" />
          <p className="export-stats">
            <span>{Math.floor(fraction * 100)}%</span>
            <span className="muted">Listening for pauses…</span>
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
          <button type="button" onClick={cancelSilence}>
            Cancel
          </button>
        ) : (
          <button type="button" onClick={closeSilence}>
            Close
          </button>
        )}
        <button type="submit" className="primary" disabled={running}>
          Remove silences
        </button>
      </div>
    </form>
  );
}
