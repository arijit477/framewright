import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatSeconds } from '../export/settings';
import { formatRelative } from '../lib/time';
import { BACKUP_EXTENSION } from '../project/backup';
import { MAX_NAME_LENGTH } from '../project/document';
import {
  closeProjectsDialog,
  deleteProject,
  downloadBackup,
  importBackup,
  newProject,
  openProject,
  openProjectsDialog,
  renameProject,
  saveProject,
  useProject,
} from '../store/project';

/** Project name and save status, in the top bar. */
export function ProjectTitle() {
  const current = useProject((s) => s.current);
  const saveState = useProject((s) => s.saveState);
  const saveError = useProject((s) => s.saveError);
  const copying = useProject((s) => s.copying);
  const persistent = useProject((s) => s.persistent);
  if (!current) return null;

  const status = !persistent
    ? 'Not saved (browser storage unavailable)'
    : saveState === 'error'
      ? 'Couldn’t save'
      : saveState !== 'saved' || copying > 0
        ? 'Saving…'
        : 'All changes saved';

  return (
    <div className="project-title">
      <button className="project-name" onClick={() => void openProjectsDialog()} title="Projects">
        {current.name} ▾
      </button>
      {saveState === 'error' ? (
        <button
          className="save-status error"
          onClick={() => void saveProject()}
          title={saveError ?? ''}
        >
          {status}. Retry
        </button>
      ) : (
        <span className="save-status" aria-live="polite">
          {status}
        </span>
      )}
    </div>
  );
}

export function ProjectsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useProject((s) => s.dialogOpen);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="export-dialog projects-dialog"
      aria-labelledby="projects-title"
      onCancel={(e) => {
        e.preventDefault();
        closeProjectsDialog();
      }}
    >
      {open && <ProjectsBody />}
    </dialog>
  );
}

function ProjectsBody() {
  const current = useProject((s) => s.current);
  const projects = useProject((s) => s.projects);
  const persistent = useProject((s) => s.persistent);
  const storage = useProject((s) => s.storage);
  const busy = useProject((s) => s.busy);
  const importInput = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const others = projects.filter((p) => p.id !== current?.id);

  return (
    <div className="export-body">
      <h2 id="projects-title">Projects</h2>

      {current && (
        <label className="project-rename">
          Current project
          <input
            // Remount when the name changes elsewhere so the draft resets.
            key={current.name}
            defaultValue={current.name}
            maxLength={MAX_NAME_LENGTH}
            aria-label="Project name"
            onBlur={(e) => renameProject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
      )}
      {current && persistent && (
        <div className="project-backup">
          <span className="muted">Keep a copy, or move it to another browser or computer:</span>
          <button onClick={() => void downloadBackup(current.id)} disabled={busy !== null}>
            Download backup
          </button>
        </div>
      )}
      {busy && (
        <p className="project-busy" aria-live="polite">
          {busy}
        </p>
      )}

      <div className="project-list-header">
        <h3>{others.length > 0 ? 'Other projects' : 'No other projects yet'}</h3>
        <div className="group">
          {persistent && (
            <button onClick={() => importInput.current?.click()} disabled={busy !== null}>
              Import backup…
            </button>
          )}
          <button className="primary" onClick={() => void newProject()}>
            New project
          </button>
        </div>
        <input
          ref={importInput}
          type="file"
          accept={`${BACKUP_EXTENSION},.zip`}
          hidden
          aria-label="Choose a backup file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importBackup(file);
            e.target.value = '';
          }}
        />
      </div>

      {others.length > 0 && (
        <ul className="project-list">
          {others.map((p) => (
            <li key={p.id}>
              <div className="project-info">
                <span className="project-list-name">{p.name}</span>
                <span className="muted">
                  Edited {formatRelative(p.updatedAt)} · {formatSeconds(p.durationUs / 1_000_000)} ·{' '}
                  {p.clipCount} clip{p.clipCount === 1 ? '' : 's'}
                </span>
              </div>
              {confirming === p.id ? (
                <>
                  <button onClick={() => setConfirming(null)}>Keep</button>
                  <button
                    className="danger"
                    onClick={() => {
                      setConfirming(null);
                      void deleteProject(p.id);
                    }}
                  >
                    Delete forever
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setConfirming(p.id)} aria-label={`Delete ${p.name}`}>
                    Delete
                  </button>
                  <button
                    onClick={() => void downloadBackup(p.id)}
                    disabled={busy !== null}
                    aria-label={`Back up ${p.name}`}
                  >
                    Back up
                  </button>
                  <button onClick={() => void openProject(p.id)} aria-label={`Open ${p.name}`}>
                    Open
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="muted project-footer">
        {persistent
          ? `Projects and their media are stored in this browser${
              storage ? ` (${formatBytes(storage.usage)} used)` : ''
            }. Clearing site data deletes them, so download a backup of anything important.`
          : 'This browser can’t store projects; export your video before closing the tab.'}
      </p>

      <div className="export-actions">
        {current && confirming !== current.id && (
          <button className="danger-quiet" onClick={() => setConfirming(current.id)}>
            Delete this project
          </button>
        )}
        {current && confirming === current.id && (
          <button
            className="danger"
            onClick={() => {
              setConfirming(null);
              void deleteProject(current.id);
            }}
          >
            Delete “{current.name}” forever
          </button>
        )}
        <button onClick={closeProjectsDialog}>Close</button>
      </div>
    </div>
  );
}
