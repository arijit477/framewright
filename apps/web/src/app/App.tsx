import { useEffect, useState } from 'react';
import {
  addText,
  deleteSelected,
  importFiles,
  selectedClip,
  toggleMute,
  initEditor,
  redo,
  splitAtPlayhead,
  stepFrames,
  togglePlay,
  undo,
  useEditor,
} from '../store/editor';
import { openExport, useExport } from '../store/export';
import {
  importBackup,
  initProjects,
  isBackupFile,
  saveProject,
  useProject,
} from '../store/project';
import { Timeline } from '../timeline/Timeline';
import { ExportDialog } from './ExportDialog';
import { MissingMediaBanner } from './MissingMedia';
import { ProjectsDialog, ProjectTitle } from './ProjectsDialog';
import { Preview } from './Preview';
import { TextInspector } from './TextInspector';
import { Toolbar } from './Toolbar';

export function App() {
  // Accept edits only once a project is open, or opening it would discard them.
  const editorReady = useEditor((s) => s.ready);
  const projectOpen = useProject((s) => s.current !== null);
  const ready = editorReady && projectOpen;
  const message = useEditor((s) => s.message);
  const backend = useEditor((s) => s.backend);
  const lastFrameMs = useEditor((s) => s.lastFrameMs);
  const audioClock = useEditor((s) => s.audioClock);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // The editor must exist before a project can be loaded into it.
    void initEditor().then(initProjects);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never treat typing in a field as shortcuts (Backspace would delete a clip).
      if (isEditable(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault(); // not the browser's "save page"
        void saveProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (useEditor.getState().duration > 0) openExport();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          break;
        case 's':
        case 'S':
          splitAtPlayhead();
          break;
        case 'm':
        case 'M': {
          const clip = selectedClip();
          if (clip) toggleMute(clip.id);
          break;
        }
        case 't':
        case 'T':
          addText();
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelected();
          break;
        case 'ArrowLeft':
          stepFrames(event.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          stepFrames(event.shiftKey ? 10 : 1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={`app ${dragging ? 'dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!ready) return;
        // A dropped backup restores a project; anything else is media.
        const files = [...e.dataTransfer.files];
        const backup = files.find(isBackupFile);
        if (backup) void importBackup(backup);
        else void importFiles(files);
      }}
    >
      <div className="chrome">
        <header className="topbar">
          <div className="topbar-left">
            <span className="brand">Framewright</span>
            <ProjectTitle />
          </div>
          <div className="topbar-right">
            <span className="status" title="Rendering backend and last frame time">
              {backend
                ? `${backend === 'webgpu' ? 'WebGPU' : 'Canvas 2D'} · ${lastFrameMs.toFixed(1)} ms/frame · ${audioClock ? 'audio clock' : 'no audio'}`
                : 'Starting…'}
            </span>
            <ExportButton />
          </div>
        </header>
        <MissingMediaBanner />
      </div>
      <ExportDialog />
      <ProjectsDialog />
      <div className="workspace">
        <Preview />
        <TextInspector />
      </div>
      {ready && <Toolbar />}
      <Timeline />
      {message && (
        <div className={`toast ${message.kind}`} role="status">
          {message.text}
        </div>
      )}
    </div>
  );
}

function ExportButton() {
  const hasClips = useEditor((s) => s.duration > 0);
  const phase = useExport((s) => s.phase);
  const progress = useExport((s) => s.progress);
  const running = phase === 'running' && progress && progress.totalFrames > 0;
  return (
    <button className="primary" onClick={openExport} disabled={!hasClips} title="Export (Ctrl+E)">
      {running
        ? `Exporting ${Math.floor((progress.framesDone / progress.totalFrames) * 100)}%`
        : 'Export'}
    </button>
  );
}

/** True for anything the user types into: inputs, text areas, selects, contenteditable. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
