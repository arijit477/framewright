import { useEffect, useRef } from 'react';
import {
  IDENTITY_TRANSFORM,
  TRANSFORM_LIMITS,
  TEXT_LIMITS,
  type Clip,
  type Transform,
} from '../engine/types';
import { ASPECTS, aspectOf, compositionSize } from '../lib/aspect';
import {
  beginGesture,
  cancelGesture,
  clipTransformAt,
  endGesture,
  previewDragTarget,
  renderer,
  requestFrame,
  setAspect,
  selectClip,
  updateGesture,
  useEditor,
  writeTransform,
} from '../store/editor';
import { roundTransform } from '../lib/keyframes';

/** Canvases already handed to the worker (React StrictMode mounts effects twice). */
const attached = new WeakSet<HTMLCanvasElement>();

interface Drag {
  clip: Clip;
  /** The playhead when the drag began: an animated clip is keyframed there. */
  at: number;
  /** A media clip's transform at that moment. */
  base: Transform;
  pointerId: number;
  startX: number;
  startY: number;
  /** The clip's position when the drag began, in thousandths of the frame. */
  fromX: number;
  fromY: number;
  width: number;
  height: number;
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const hasClips = useEditor((s) => s.duration > 0);
  const importing = useEditor((s) => s.importing > 0);
  const draggable = useEditor((s) => previewDragTarget(s) !== null);
  const aspect = useEditor((s) => aspectOf(s.timeline));
  const frame = compositionSize(aspect);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || attached.has(canvas)) return;
    attached.add(canvas);
    renderer.attach(canvas);
    requestFrame();
  }, []);

  // Escape cancels a drag in progress, restoring the clip.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      canvasRef.current?.releasePointerCapture(drag.current.pointerId);
      drag.current = null;
      cancelGesture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Drag the selected (or topmost) visible clip to move it; one undo step per drag. */
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const clip = previewDragTarget();
    if (!clip) return;
    selectClip(clip.id);
    const at = useEditor.getState().playhead;
    const base = clip.text ? IDENTITY_TRANSFORM : roundTransform(clipTransformAt(clip.id, at));
    const from = clip.text ? clip.text.style : base;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginGesture();
    drag.current = {
      clip,
      at,
      base,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromX: from.x,
      fromY: from.y,
      width: rect.width,
      height: rect.height,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    // Screen pixels -> thousandths of the frame, so it works at any preview size.
    const x = Math.round(d.fromX + ((event.clientX - d.startX) / d.width) * 1000);
    const y = Math.round(d.fromY + ((event.clientY - d.startY) / d.height) * 1000);
    const { clip, at, base } = d;
    updateGesture((e) => {
      if (clip.text) {
        const max = TEXT_LIMITS.positionScale;
        e.setClipText(clip.id, {
          ...clip.text,
          style: { ...clip.text.style, x: clamp(x, 0, max), y: clamp(y, 0, max) },
        });
      } else {
        const { minPosition: min, maxPosition: max } = TRANSFORM_LIMITS;
        writeTransform(e, clip, { ...base, x: clamp(x, min, max), y: clamp(y, min, max) }, at);
      }
    });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    endGesture();
  };

  const onPointerCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    cancelGesture();
  };

  return (
    <div className="preview">
      <div
        className="preview-frame"
        data-aspect={aspect}
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Preview"
          className={draggable ? 'draggable' : undefined}
          title={draggable ? 'Drag to move the selected clip' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
        {!hasClips && (
          <div className="preview-empty">
            {importing ? 'Importing…' : 'Import or drop a video to get started'}
          </div>
        )}
      </div>
      <div className="segmented frame-shapes" role="group" aria-label="Frame shape">
        {ASPECTS.map((a) => (
          <button
            key={a.value}
            aria-pressed={aspect === a.value}
            className={aspect === a.value ? 'active' : ''}
            title={a.hint}
            onClick={() => setAspect(a.value)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
