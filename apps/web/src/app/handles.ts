import { TRANSFORM_LIMITS, type Transform } from '../engine/types';
import { apply, layerMatrix } from '../render/transform';

/**
 * Geometry for the resize and rotate handles on the preview: where a clip's
 * outline and handles sit, and the transform a drag on a handle produces.
 * Points are in preview pixels (CSS px, origin top left, y down).
 */

export type Point = [number, number];

/** The rotate handle sits this far outside the clip's top edge (px). */
export const ROTATE_HANDLE_OFFSET = 28;
/** With Shift held, rotation snaps to multiples of this. */
export const ROTATION_SNAP_DEG = 15;

export interface ClipOutline {
  centre: Point;
  /** Top left, top right, bottom right, bottom left (before rotation). */
  corners: [Point, Point, Point, Point];
  /**
   * Above the middle of the top edge, turning with the clip; just inside the
   * edge if above it would be off the preview.
   */
  rotateHandle: Point;
}

/** Where a clip with this source size and transform appears on a preview of this size. */
export function clipOutline(
  sourceWidth: number,
  sourceHeight: number,
  previewWidth: number,
  previewHeight: number,
  transform: Transform,
): ClipOutline {
  const m = layerMatrix(sourceWidth, sourceHeight, previewWidth, previewHeight, transform);
  const corners = [
    apply(m, 0, 0),
    apply(m, 1, 0),
    apply(m, 1, 1),
    apply(m, 0, 1),
  ] as ClipOutline['corners'];
  const centre = apply(m, 0.5, 0.5);
  const top = apply(m, 0.5, 0);
  // "Up" for the clip: from its centre towards the middle of its top edge.
  const angle = (transform.rotationDeg * Math.PI) / 180;
  const up: Point = [Math.sin(angle), -Math.cos(angle)];
  const outside: Point = [
    top[0] + up[0] * ROTATE_HANDLE_OFFSET,
    top[1] + up[1] * ROTATE_HANDLE_OFFSET,
  ];
  const onPreview = ([x, y]: Point) => x >= 0 && x <= previewWidth && y >= 0 && y <= previewHeight;
  return {
    centre,
    corners,
    // Inside the top edge instead when outside would be off the preview (e.g. a full-frame clip).
    rotateHandle: onPreview(outside)
      ? outside
      : [top[0] - up[0] * ROTATE_HANDLE_OFFSET, top[1] - up[1] * ROTATE_HANDLE_OFFSET],
  };
}

const distance = ([x1, y1]: Point, [x2, y2]: Point) => Math.hypot(x2 - x1, y2 - y1);

/**
 * Scale after dragging a corner from `from` to `to`: in proportion to the
 * pointer's distance from the clip's centre, so the clip keeps its shape and
 * the corner follows the pointer.
 */
export function scaleFromDrag(centre: Point, from: Point, to: Point, startPercent: number): number {
  const start = distance(centre, from);
  if (start < 1) return startPercent;
  const percent = Math.round((startPercent * distance(centre, to)) / start);
  return Math.min(TRANSFORM_LIMITS.maxScale, Math.max(TRANSFORM_LIMITS.minScale, percent));
}

/**
 * Rotation after dragging the rotate handle from `from` to `to` around the
 * clip's centre: the clip turns as far as the pointer does. Whole degrees in
 * −180…180; with `snap`, the nearest multiple of 15°.
 */
export function rotationFromDrag(
  centre: Point,
  from: Point,
  to: Point,
  startDeg: number,
  snap = false,
): number {
  const angleOf = ([x, y]: Point) => (Math.atan2(y - centre[1], x - centre[0]) * 180) / Math.PI;
  let deg = startDeg + angleOf(to) - angleOf(from);
  deg = ((((deg + 180) % 360) + 360) % 360) - 180; // −180 ≤ deg < 180
  deg = snap ? Math.round(deg / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG : Math.round(deg);
  return deg === -180 ? 180 : deg + 0; // one name for a half turn; no −0
}
