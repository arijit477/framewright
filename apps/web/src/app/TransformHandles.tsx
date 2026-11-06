import { useEffect, useRef, useState } from 'react';
import { clipEnd, type Clip, type Transform } from '../engine/types';
import {
  beginGesture,
  cancelGesture,
  clipTransformAt,
  endGesture,
  selectedClip,
  updateGesture,
  useEditor,
  writeTransform,
} from '../store/editor';
import { roundTransform } from '../lib/keyframes';
import { clipOutline, rotationFromDrag, scaleFromDrag, type Point } from './handles';

interface HandleDrag {
  kind: 'resize' | 'rotate';
  clip: Clip;
  /** The playhead when the drag began: an animated clip is keyframed there. */
  at: number;
  base: Transform;
  centre: Point;
  from: Point;
  pointerId: number;
  target: HTMLElement;
}

const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'] as const;

/**
 * Resize and rotate handles over the preview for the selected video or image
 * clip, while it's on screen. Corners scale it about its centre; the round
 * handle turns it (Shift snaps to 15°). Each drag is one undo step, and an
 * animated clip is keyframed at the playhead, as when dragging to move it.
 * Escape cancels a drag. The Transform panel offers the same by keyboard.
 */
export function TransformHandles({ frame }: { frame: React.RefObject<HTMLElement | null> }) {
  const clip = useEditor((s) => {
    const c = selectedClip(s);
    const asset = c && !c.text ? s.assets[c.assetId] : undefined;
    const onScreen = c && c.start <= s.playhead && s.playhead < clipEnd(c);
    return c && onScreen && asset?.hasVideo && !asset.missing ? c : null;
  });
  const asset = useEditor((s) => (clip ? s.assets[clip.assetId] : undefined));
  const playhead = useEditor((s) => s.playhead);
  useEditor((s) => s.timeline); // follow edits (the transform comes from the engine)
  const size = usePreviewSize(frame);
  const drag = useRef<HandleDrag | null>(null);

  // Escape cancels a handle drag in progress, restoring the clip.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const d = drag.current;
      if (event.key !== 'Escape' || !d) return;
      d.target.releasePointerCapture(d.pointerId);
      drag.current = null;
      cancelGesture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!clip || !asset || !size || asset.width <= 0 || asset.height <= 0) return null;
  const transform = clipTransformAt(clip.id, playhead);
  const outline = clipOutline(asset.width, asset.height, size.width, size.height, transform);

  const pointIn = (event: React.PointerEvent): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginGesture();
    drag.current = {
      kind: event.currentTarget.dataset.kind === 'rotate' ? 'rotate' : 'resize',
      clip,
      at: playhead,
      base: roundTransform(transform),
      centre: outline.centre,
      from: pointIn(event),
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const to = pointIn(event);
    const next: Transform =
      d.kind === 'resize'
        ? { ...d.base, scalePercent: scaleFromDrag(d.centre, d.from, to, d.base.scalePercent) }
        : {
            ...d.base,
            rotationDeg: rotationFromDrag(d.centre, d.from, to, d.base.rotationDeg, event.shiftKey),
          };
    updateGesture((e) => writeTransform(e, d.clip, next, d.at));
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

  const handlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
  const at = ([x, y]: Point) => ({ left: `${x}px`, top: `${y}px` });

  return (
    <div className="transform-handles">
      <svg width={size.width} height={size.height} aria-hidden="true">
        <polygon points={outline.corners.map((p) => p.join(',')).join(' ')} />
      </svg>
      {outline.corners.map((corner, i) => (
        <div
          key={CORNERS[i]}
          className="handle resize"
          style={at(corner)}
          aria-label={`Resize from the ${CORNERS[i]} corner`}
          title="Drag to resize"
          data-kind="resize"
          {...handlers}
        />
      ))}
      <div
        className="handle rotate"
        style={at(outline.rotateHandle)}
        aria-label="Rotate"
        title="Drag to rotate (Shift snaps to 15°)"
        data-kind="rotate"
        {...handlers}
      />
    </div>
  );
}

/** The preview frame's size in CSS pixels, kept up to date. */
function usePreviewSize(frame: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame]);
  return size;
}
