import { useRef } from 'react';
import { formatTimecode } from '../lib/time';
import { ClipAudio, LevelMeter } from './ClipAudio';
import {
  deleteSelected,
  importFiles,
  redo,
  setView,
  splitAtPlayhead,
  togglePlay,
  undo,
  useEditor,
} from '../store/editor';

export function Toolbar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const duration = useEditor((s) => s.duration);
  const hasSelection = useEditor((s) => s.selectedClipId !== null);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const pxPerSecond = useEditor((s) => s.view.pxPerSecond);

  return (
    <div className="toolbar" role="toolbar">
      <div className="group">
        <button className="primary" onClick={() => fileInput.current?.click()}>
          Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="video/*,audio/*,.mkv,.mov,.m4a,.flac"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>

      <div className="group">
        <button
          onClick={togglePlay}
          disabled={duration === 0}
          title="Play / pause (Space)"
          className="play"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <LevelMeter />
        <span className="timecode" aria-label="Playhead time">
          {formatTimecode(playhead)} <span className="muted">/ {formatTimecode(duration)}</span>
        </span>
      </div>

      <ClipAudio />

      <div className="group">
        <button onClick={splitAtPlayhead} disabled={duration === 0} title="Split at playhead (S)">
          Split
        </button>
        <button onClick={deleteSelected} disabled={!hasSelection} title="Delete clip (Delete)">
          Delete
        </button>
        <label className="zoom">
          Zoom
          <input
            type="range"
            min={Math.log(4)}
            max={Math.log(800)}
            step={0.01}
            value={Math.log(pxPerSecond)}
            onChange={(e) => setView({ pxPerSecond: Math.exp(Number(e.target.value)) })}
          />
        </label>
      </div>
    </div>
  );
}
