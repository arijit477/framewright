import { useEffect, useRef } from 'react';
import { renderer, requestFrame, useEditor } from '../store/editor';
import { COMPOSITION } from '../render/protocol';

/** Canvases already handed to the worker (React StrictMode mounts effects twice). */
const attached = new WeakSet<HTMLCanvasElement>();

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasClips = useEditor((s) => s.duration > 0);
  const importing = useEditor((s) => s.importing > 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || attached.has(canvas)) return;
    attached.add(canvas);
    renderer.attach(canvas);
    requestFrame();
  }, []);

  return (
    <div className="preview">
      <div
        className="preview-frame"
        style={{ aspectRatio: `${COMPOSITION.width} / ${COMPOSITION.height}` }}
      >
        <canvas ref={canvasRef} aria-label="Preview" />
        {!hasClips && (
          <div className="preview-empty">
            {importing ? 'Importing…' : 'Import or drop a video to get started'}
          </div>
        )}
      </div>
    </div>
  );
}
