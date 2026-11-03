import { useEffect, useRef } from 'react';
import {
  estimateBytes,
  FORMATS,
  formatBytes,
  formatSeconds,
  FRAME_RATES,
  RESOLUTIONS,
  type ExportFormat,
  type ExportQuality,
  type ExportResolution,
} from '../export/settings';
import { useEditor } from '../store/editor';
import {
  cancelExport,
  closeExport,
  startExport,
  updateSettings,
  useExport,
  type ExportState,
} from '../store/export';

export function ExportDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useExport((s) => s.open);

  // Drive the native modal from state (focus trap, Esc and backdrop for free).
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
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault(); // Esc: route through state so it stays in sync
        closeExport();
      }}
    >
      {open && <ExportBody />}
    </dialog>
  );
}

function ExportBody() {
  const state = useExport();
  return (
    <div className="export-body">
      <h2 id="export-title">Export video</h2>
      {state.phase === 'running' ? (
        <Progress state={state} />
      ) : state.phase === 'done' && state.result ? (
        <Done result={state.result} />
      ) : (
        <Settings state={state} />
      )}
    </div>
  );
}

function Settings({ state }: { state: ExportState }) {
  const { settings } = state;
  const duration = useEditor((s) => s.duration);
  const hasAudio = useEditor((s) =>
    s.timeline.tracks.some((t) => t.clips.some((c) => !c.muted && s.assets[c.assetId]?.hasAudio)),
  );
  const { width, height } = RESOLUTIONS[settings.resolution];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        startExport();
      }}
    >
      {state.phase === 'error' && (
        <p className="export-error" role="alert">
          Export failed: {state.error}
        </p>
      )}
      {state.phase === 'cancelled' && <p className="muted">Export cancelled.</p>}

      <div className="export-grid">
        <label>
          Format
          <select
            value={settings.format}
            onChange={(e) => updateSettings({ format: e.target.value as ExportFormat })}
          >
            {(Object.keys(FORMATS) as ExportFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMATS[f].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resolution
          <select
            value={settings.resolution}
            onChange={(e) => updateSettings({ resolution: e.target.value as ExportResolution })}
          >
            {(Object.keys(RESOLUTIONS) as ExportResolution[]).map((r) => (
              <option key={r} value={r}>
                {r} ({RESOLUTIONS[r].width}×{RESOLUTIONS[r].height})
              </option>
            ))}
          </select>
        </label>
        <label>
          Frame rate
          <select
            value={settings.fps}
            onChange={(e) => updateSettings({ fps: Number(e.target.value) as typeof settings.fps })}
          >
            {FRAME_RATES.map((fps) => (
              <option key={fps} value={fps}>
                {fps} fps
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality
          <select
            value={settings.quality}
            onChange={(e) => updateSettings({ quality: e.target.value as ExportQuality })}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low (smallest file)</option>
          </select>
        </label>
      </div>

      <p className="muted export-summary">
        {width}×{height} · {formatSeconds(duration / 1_000_000)} · about{' '}
        {formatBytes(estimateBytes(duration, settings, hasAudio))}
        {hasAudio ? '' : ' · no audio'}
      </p>

      <div className="export-actions">
        <button type="button" onClick={closeExport}>
          Close
        </button>
        <button type="submit" className="primary" disabled={duration === 0}>
          Export
        </button>
      </div>
    </form>
  );
}

function Progress({ state }: { state: ExportState }) {
  const { framesDone = 0, totalFrames = 0, elapsedMs = 0 } = state.progress ?? {};
  const fraction = totalFrames > 0 ? framesDone / totalFrames : 0;
  const remaining = fraction > 0.02 ? (elapsedMs / fraction - elapsedMs) / 1000 : NaN;
  const speed = elapsedMs > 0 ? framesDone / state.settings.fps / (elapsedMs / 1000) : 0;
  return (
    <div>
      <progress max={1} value={fraction} aria-label="Export progress" />
      <p className="export-stats">
        {totalFrames === 0 ? (
          <span className="muted">Preparing: opening media and starting the encoder…</span>
        ) : (
          <>
            <span>{Math.floor(fraction * 100)}%</span>
            <span className="muted">
              {framesDone} / {totalFrames} frames · {speed.toFixed(1)}× real time ·{' '}
              {formatSeconds(remaining)} left
            </span>
          </>
        )}
      </p>
      <p className="muted">You can keep editing; the export uses a snapshot of the project.</p>
      <div className="export-actions">
        <button type="button" onClick={closeExport}>
          Hide
        </button>
        <button type="button" onClick={cancelExport}>
          Cancel export
        </button>
      </div>
    </div>
  );
}

function Done({ result }: { result: NonNullable<ExportState['result']> }) {
  return (
    <div>
      <p className="export-done">
        ✓ Exported in {formatSeconds(result.elapsedMs / 1000)} · {formatBytes(result.bytes)}
      </p>
      <p className="muted">
        {result.fileName} · video {result.videoCodec}
        {result.audioCodec ? ` · audio ${result.audioCodec}` : ' · no audio'}
      </p>
      {result.warnings.map((w) => (
        <p key={w} className="export-warning">
          {w}
        </p>
      ))}
      <div className="export-actions">
        <button type="button" onClick={closeExport}>
          Close
        </button>
        <a className="button primary" href={result.url} download={result.fileName}>
          Download
        </a>
      </div>
    </div>
  );
}
