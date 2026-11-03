import { useEffect, useState } from 'react';
import {
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
import { Timeline } from '../timeline/Timeline';
import { ExportDialog } from './ExportDialog';
import { Preview } from './Preview';
import { Toolbar } from './Toolbar';

export function App() {
  const ready = useEditor((s) => s.ready);
  const message = useEditor((s) => s.message);
  const backend = useEditor((s) => s.backend);
  const lastFrameMs = useEditor((s) => s.lastFrameMs);
  const audioClock = useEditor((s) => s.audioClock);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void initEditor();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const mod = event.ctrlKey || event.metaKey;
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
        void importFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <span className="brand">Framewright</span>
        <div className="topbar-right">
          <span className="status" title="Rendering backend and last frame time">
            {backend
              ? `${backend === 'webgpu' ? 'WebGPU' : 'Canvas 2D'} · ${lastFrameMs.toFixed(1)} ms/frame · ${audioClock ? 'audio clock' : 'no audio'}`
              : 'Starting…'}
          </span>
          <ExportButton />
        </div>
      </header>
      <ExportDialog />
      <Preview />
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
