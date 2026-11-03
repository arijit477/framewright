import { useCallback, useEffect, useRef } from 'react';
import { clipEnd, type Clip, type Track, type TrackKind } from '../engine/types';
import { PEAKS_PER_SECOND } from '../audio/protocol';
import { formatTimecode, MICROS_PER_SECOND, rulerStep } from '../lib/time';
import {
  edit,
  moveClip,
  seek,
  selectClip,
  setView,
  thumbnails,
  useEditor,
  type EditorState,
} from '../store/editor';
import type { ThumbnailStrip } from '../thumbnails/client';
import { indexAt, layoutTiles, nearestLoaded } from '../thumbnails/strip';
import { TrackList } from './TrackList';
import {
  dropTarget,
  hitTest,
  maxScrollY,
  peakToHeight,
  RULER_HEIGHT,
  snap,
  timeToX,
  TRACK_GAP,
  TRACK_HEIGHT,
  trackRows,
  trackTop,
  xToTime,
  type DropTarget,
  type View,
} from './geometry';

const COLORS = {
  background: '#101015',
  ruler: '#17171e',
  tick: '#3a3a48',
  label: '#8c8ca1',
  track: '#16161d',
  clip: '#4f46e5',
  clipSelected: '#818cf8',
  audioClip: '#0f766e',
  missingClip: '#4a1d2a',
  missingClipSelected: '#7f1d3a',
  audioClipSelected: '#14b8a6',
  waveform: 'rgba(238,240,255,0.55)',
  waveformMuted: 'rgba(238,240,255,0.18)',
  trackLabel: '#5b5b70',
  clipText: '#eef0ff',
  handle: 'rgba(255,255,255,0.55)',
  playhead: '#f43f5e',
  newTrack: '#a5b4fc',
};

/** Moving a clip in time and, optionally, to another or a new track. */
interface MoveDrag {
  kind: 'move';
  clip: Clip;
  grabOffsetUs: number;
  previewStart: number;
  originTrackId: number;
  trackKind: TrackKind;
  target: DropTarget;
}

/** A drag in progress. Edits are previewed locally and committed on release. */
type Drag =
  | { kind: 'scrub' }
  | MoveDrag
  | { kind: 'trim'; clip: Clip; edge: 'start' | 'end'; previewAt: number };

/**
 * The timeline is drawn on a canvas, not with DOM elements: thousands of clips
 * and thumbnails stay at 60 fps, and only the visible range is drawn.
 */
export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const state = useEditor.getState();
    // Keep the vertical scroll valid when tracks are removed or the panel resizes.
    const maxY = maxScrollY(trackRows(state.timeline).length, canvas.clientHeight);
    if (state.view.scrollY > maxY) {
      setView({ scrollY: maxY }); // re-renders via the store subscription
      return;
    }
    paint(ctx, canvas, state, dragRef.current);
  }, []);

  // Redraw on every store change, and when the element resizes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = container.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const unsubscribe = useEditor.subscribe(draw);
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [draw]);

  const pointer = (event: React.PointerEvent | React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const snapTargets = (exclude: number) => {
    const { timeline, playhead } = useEditor.getState();
    const edges = timeline.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.id !== exclude)
      .flatMap((c) => [c.start, clipEnd(c)]);
    return [0, playhead, ...edges];
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = pointer(event);
    const { timeline, view } = useEditor.getState();
    const hit = hitTest(timeline, view, x, y);
    const at = xToTime(x, view);

    if (hit.kind === 'clip') {
      selectClip(hit.clip.id);
      dragRef.current = hit.edge
        ? {
            kind: 'trim',
            clip: hit.clip,
            edge: hit.edge,
            previewAt: hit.edge === 'start' ? hit.clip.start : clipEnd(hit.clip),
          }
        : {
            kind: 'move',
            clip: hit.clip,
            grabOffsetUs: at - hit.clip.start,
            previewStart: hit.clip.start,
            originTrackId: hit.trackId,
            trackKind: timeline.tracks.find((t) => t.id === hit.trackId)?.kind ?? 'video',
            target: { type: 'track', trackId: hit.trackId },
          };
    } else {
      if (hit.kind !== 'ruler') selectClip(null);
      dragRef.current = { kind: 'scrub' };
      seek(at);
    }
    draw();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pointer(event);
    const { view, timeline } = useEditor.getState();
    const drag = dragRef.current;
    const at = xToTime(x, view);

    if (!drag) {
      const hit = hitTest(timeline, view, x, y);
      event.currentTarget.style.cursor =
        hit.kind === 'clip' ? (hit.edge ? 'ew-resize' : 'grab') : 'default';
      return;
    }
    switch (drag.kind) {
      case 'scrub':
        seek(at);
        break;
      case 'move': {
        const targets = snapTargets(drag.clip.id);
        const start = Math.max(0, at - drag.grabOffsetUs);
        // Snap whichever edge of the clip is closer to a target.
        const snappedStart = snap(start, targets, view);
        const snappedEnd = snap(start + drag.clip.duration, targets, view) - drag.clip.duration;
        drag.previewStart =
          snappedStart !== start ? snappedStart : snappedEnd !== start ? snappedEnd : start;
        drag.target = dropTarget(timeline, view, y, drag.trackKind);
        draw();
        break;
      }
      case 'trim':
        drag.previewAt = snap(at, snapTargets(drag.clip.id), view);
        draw();
        break;
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'move') {
      const { target } = drag;
      const sameTrack = target.type === 'track' && target.trackId === drag.originTrackId;
      if (!sameTrack) {
        moveClip(
          drag.clip.id,
          drag.previewStart,
          target.type === 'new' ? { newTrack: target.kind } : { trackId: target.trackId },
        );
      } else if (drag.previewStart !== drag.clip.start) {
        moveClip(drag.clip.id, drag.previewStart);
      }
    } else if (drag?.kind === 'trim') {
      const original = drag.edge === 'start' ? drag.clip.start : clipEnd(drag.clip);
      if (drag.previewAt !== original)
        edit((e) => e.trimClip(drag.clip.id, drag.edge, drag.previewAt));
    }
    draw();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const { view } = useEditor.getState();
    if (event.ctrlKey || event.metaKey) {
      // Zoom around the pointer so the time under it stays put.
      const { x } = pointer(event);
      const anchor = xToTime(x, view);
      const pxPerSecond = clamp(view.pxPerSecond * Math.exp(-event.deltaY * 0.002), 4, 800);
      const next: View = { ...view, pxPerSecond, scrollUs: 0 };
      next.scrollUs = Math.max(0, anchor - xToTime(x, next));
      setView(next);
      return;
    }
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    const rows = trackRows(useEditor.getState().timeline).length;
    const maxY = maxScrollY(rows, event.currentTarget.clientHeight);
    if (!horizontal && maxY > 0) {
      // Tracks overflow the panel: the wheel scrolls them vertically.
      setView({ scrollY: clamp(view.scrollY + event.deltaY, 0, maxY) });
      return;
    }
    const delta = horizontal && event.deltaX !== 0 ? event.deltaX : event.deltaY;
    setView({
      scrollUs: Math.max(0, view.scrollUs + (delta / view.pxPerSecond) * MICROS_PER_SECOND),
    });
  };

  return (
    <div ref={containerRef} className="timeline" aria-label="Timeline">
      <TrackList />
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function paint(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: EditorState,
  drag: Drag | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const { view, timeline, playhead } = state;
  const rows = trackRows(timeline);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // A clip being moved to another (or a new) track is drawn there, not in its own row.
  const moving = drag?.kind === 'move' ? drag : null;
  const movesAway = (trackId: number) =>
    moving !== null &&
    (moving.target.type === 'new' ||
      (moving.target.type === 'track' && moving.target.trackId !== trackId));

  rows.forEach((track, row) => {
    const top = trackTop(row, view.scrollY);
    if (top + TRACK_HEIGHT < RULER_HEIGHT || top > height) return; // off screen
    ctx.fillStyle = COLORS.track;
    ctx.fillRect(0, top, width, TRACK_HEIGHT);
    if (track.clips.length === 0) {
      ctx.fillStyle = COLORS.trackLabel;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        track.kind === 'audio' ? 'Audio: drop music or voice-over here' : 'Video',
        timeToX(0, view) + 8,
        top + TRACK_HEIGHT / 2,
      );
    }
    for (const clip of track.clips) {
      if (moving?.clip.id === clip.id && movesAway(track.id)) continue;
      drawClip(ctx, state, drag, { clip, kind: track.kind, top, width });
    }
    // A clip being dragged here from another track is previewed on this row.
    if (
      moving?.target.type === 'track' &&
      moving.target.trackId === track.id &&
      moving.originTrackId !== track.id
    ) {
      drawClip(ctx, state, drag, { clip: moving.clip, kind: track.kind, top, width });
    }
  });

  drawRuler(ctx, view, width);
  // After the ruler: the hint for a new top track sits right under it.
  if (moving?.target.type === 'new') drawNewTrackHint(ctx, state, drag, moving, rows, width);
  drawPlayhead(ctx, timeToX(playhead, view), height);
}

/** Draw one clip (at its preview position while it's being dragged or trimmed). */
function drawClip(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  drag: Drag | null,
  {
    clip,
    kind,
    top,
    width,
    ghost = false,
  }: { clip: Clip; kind: TrackKind; top: number; width: number; ghost?: boolean },
) {
  const { view, assets, peaks, selectedClipId } = state;
  let start = clip.start;
  let end = clipEnd(clip);
  if (drag && drag.kind !== 'scrub' && drag.clip.id === clip.id) {
    if (drag.kind === 'move') {
      start = drag.previewStart;
      end = start + clip.duration;
    } else if (drag.edge === 'start') {
      start = Math.min(drag.previewAt, end);
    } else {
      end = Math.max(drag.previewAt, start);
    }
  }
  const left = timeToX(start, view);
  const right = timeToX(end, view);
  if (right < 0 || left > width) return;

  ctx.save();
  if (ghost) ctx.globalAlpha = 0.75;
  const selected = clip.id === selectedClipId;
  const isAudio = kind === 'audio';
  const missing = assets[clip.assetId]?.missing ?? false;
  ctx.fillStyle = missing
    ? selected
      ? COLORS.missingClipSelected
      : COLORS.missingClip
    : isAudio
      ? selected
        ? COLORS.audioClipSelected
        : COLORS.audioClip
      : selected
        ? COLORS.clipSelected
        : COLORS.clip;
  roundRect(ctx, left, top + 2, right - left, TRACK_HEIGHT - 4, 6);
  ctx.fill();
  // Source time follows the clip while it is being dragged.
  const origin = drag?.kind === 'move' && drag.clip.id === clip.id ? start : clip.start;
  const sourceAtX = (x: number) => clip.sourceIn + (xToTime(x, view) - origin);
  const strip = !missing && !isAudio ? thumbnails.strip(clip.assetId) : undefined;
  const filmstrip = strip !== undefined && strip.loaded > 0;
  if (filmstrip) {
    drawFilmstrip(ctx, strip, {
      left,
      right,
      top: top + 2,
      height: TRACK_HEIGHT - 4,
      viewportWidth: width,
      sourceAtX,
      selected,
    });
  }
  if (selected) {
    ctx.fillStyle = COLORS.handle;
    ctx.fillRect(left + 2, top + 14, 3, TRACK_HEIGHT - 28);
    ctx.fillRect(right - 5, top + 14, 3, TRACK_HEIGHT - 28);
  }
  ctx.beginPath();
  ctx.rect(left + 8, top, Math.max(0, right - left - 16), TRACK_HEIGHT);
  ctx.clip();
  // Waveform: a slim band under the filmstrip, or the lower half of a plain clip.
  const clipPeaks = peaks[clip.assetId];
  if (clipPeaks) {
    drawWaveform(ctx, clipPeaks, {
      left: Math.max(left, 0),
      right: Math.min(right, width),
      top: filmstrip ? top + TRACK_HEIGHT - 19 : top + 26,
      height: filmstrip ? 14 : TRACK_HEIGHT - 32,
      view,
      sourceAt: (t) => clip.sourceIn + (t - origin),
      gain: clip.volumePercent / 100,
      muted: clip.muted,
    });
  }
  ctx.fillStyle = COLORS.clipText;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const status = missing
    ? '  ·  missing media'
    : clip.muted
      ? '  ·  muted'
      : clip.volumePercent !== 100
        ? `  ·  ${clip.volumePercent}%`
        : '';
  // Pin the label to the visible part of the clip, so it stays readable when scrolled.
  ctx.fillText(
    `${assets[clip.assetId]?.name ?? 'Clip'}${status}`,
    Math.max(left, 0) + 10,
    top + 15,
  );
  ctx.fillStyle = 'rgba(238,240,255,0.7)';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(formatTimecode(end - start), right - 10, top + 15);
  ctx.textAlign = 'left';
  ctx.restore();
}

/**
 * Dragging past the top video row (or below the last audio row) creates a
 * track: show where it will appear and a translucent preview of the clip.
 */
function drawNewTrackHint(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  drag: Drag | null,
  moving: MoveDrag,
  rows: readonly Track[],
  width: number,
) {
  const { scrollY } = state.view;
  const kind = moving.trackKind;
  const ownRows = rows.flatMap((t, row) => (t.kind === kind ? [row] : []));
  const lineY =
    kind === 'video'
      ? trackTop(ownRows[0] ?? 0, scrollY) - TRACK_GAP / 2
      : trackTop((ownRows.at(-1) ?? rows.length - 1) + 1, scrollY) - TRACK_GAP / 2;
  ctx.fillStyle = COLORS.newTrack;
  ctx.fillRect(0, lineY - 1.5, width, 3);
  // The preview straddles the insertion line, so it's clear where the track will appear.
  const ghostTop = lineY - TRACK_HEIGHT / 2;
  drawClip(ctx, state, drag, { clip: moving.clip, kind, top: ghostTop, width, ghost: true });
  const label = kind === 'video' ? '+ New video track' : '+ New audio track';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const labelWidth = ctx.measureText(label).width + 16;
  const labelX = width - labelWidth - 12;
  ctx.fillStyle = COLORS.newTrack;
  roundRect(ctx, labelX, lineY - 11, labelWidth, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#0b0b0f';
  ctx.fillText(label, labelX + 8, lineY);
}

/** Drawn after the tracks so it stays on top while they scroll underneath. */
function drawRuler(ctx: CanvasRenderingContext2D, view: View, width: number) {
  ctx.fillStyle = COLORS.ruler;
  ctx.fillRect(0, 0, width, RULER_HEIGHT);
  const step = rulerStep(view.pxPerSecond);
  const firstTick = Math.floor(view.scrollUs / step) * step;
  const lastVisible = xToTime(width, view);
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let t = firstTick; t <= lastVisible; t += step) {
    const x = Math.round(timeToX(t, view)) + 0.5;
    ctx.strokeStyle = COLORS.tick;
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT - 8);
    ctx.lineTo(x, RULER_HEIGHT);
    ctx.stroke();
    ctx.fillStyle = COLORS.label;
    ctx.fillText(formatTimecode(t).slice(0, 5), x + 4, RULER_HEIGHT / 2 - 2);
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, x: number, height: number) {
  const px = Math.round(x) + 0.5;
  ctx.strokeStyle = COLORS.playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, height);
  ctx.stroke();
  ctx.fillStyle = COLORS.playhead;
  ctx.beginPath();
  ctx.moveTo(px - 6, 0);
  ctx.lineTo(px + 6, 0);
  ctx.lineTo(px, 8);
  ctx.fill();
  ctx.lineWidth = 1;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, w / 2));
}

interface WaveformArea {
  left: number;
  right: number;
  top: number;
  height: number;
  view: View;
  /** Maps timeline time to source time. */
  sourceAt: (timelineUs: number) => number;
  gain: number;
  muted: boolean;
}

/** One vertical bar per pixel: the loudest peak in the time that pixel covers. */
function drawWaveform(ctx: CanvasRenderingContext2D, peaks: Float32Array, area: WaveformArea) {
  const mid = area.top + area.height / 2;
  ctx.fillStyle = area.muted ? COLORS.waveformMuted : COLORS.waveform;
  const usPerPx = MICROS_PER_SECOND / area.view.pxPerSecond;
  for (let x = Math.floor(area.left); x < area.right; x++) {
    const sourceUs = area.sourceAt(xToTime(x, area.view));
    const from = Math.floor((sourceUs / MICROS_PER_SECOND) * PEAKS_PER_SECOND);
    const to = Math.max(
      from + 1,
      Math.ceil(((sourceUs + usPerPx) / MICROS_PER_SECOND) * PEAKS_PER_SECOND),
    );
    let peak = 0;
    for (let i = Math.max(0, from); i < Math.min(to, peaks.length); i++)
      peak = Math.max(peak, peaks[i]!);
    const h = Math.max(1, peakToHeight(peak * area.gain) * area.height);
    ctx.fillRect(x, mid - h / 2, 1, h);
  }
}

interface FilmstripArea {
  left: number;
  right: number;
  top: number;
  height: number;
  viewportWidth: number;
  /** Source time (µs) shown at a given x. */
  sourceAtX: (x: number) => number;
  selected: boolean;
}

/**
 * Tile a clip with thumbnails (only the visible tiles), using the nearest
 * loaded one while the strip is still filling in, then shade the top and
 * bottom so the name and waveform stay legible.
 */
function drawFilmstrip(ctx: CanvasRenderingContext2D, strip: ThumbnailStrip, area: FilmstripArea) {
  const { left, right, top, height } = area;
  const tileWidth = (height * strip.width) / strip.height;
  ctx.save();
  roundRect(ctx, left, top, right - left, height, 6);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  for (const tile of layoutTiles({
    clipLeft: left,
    clipRight: right,
    tileWidth,
    viewportWidth: area.viewportWidth,
    sourceAt: area.sourceAtX,
  })) {
    const index = nearestLoaded(
      indexAt(tile.sourceUs, strip.intervalUs, strip.count),
      (i) => strip.bitmaps[i] !== undefined,
      strip.count,
    );
    const bitmap = index >= 0 ? strip.bitmaps[index] : undefined;
    if (bitmap) ctx.drawImage(bitmap, tile.x, top, tileWidth, height);
  }
  const shadeTop = ctx.createLinearGradient(0, top, 0, top + 22);
  shadeTop.addColorStop(0, 'rgba(0,0,0,0.6)');
  shadeTop.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadeTop;
  ctx.fillRect(left, top, right - left, 22);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(left, top + height - 18, right - left, 18);
  ctx.restore();
  if (area.selected) {
    ctx.strokeStyle = COLORS.clipSelected;
    ctx.lineWidth = 2;
    roundRect(ctx, left + 1, top + 1, right - left - 2, height - 2, 5);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}
