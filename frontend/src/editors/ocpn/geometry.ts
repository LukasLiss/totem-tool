import type { XY } from '@/editors/shared/model-types';

import { nodeSize } from './model';
import type { OcpnFlowNode } from './types';

/**
 * Floating-arc geometry: arcs attach to the node border on the straight line
 * towards their next path point (circle border for places, rectangle border
 * for transitions) instead of at fixed handle positions. The same helpers are
 * used by the drawn edge, the connection-line preview and the editor's
 * bend-point insertion, so all three always agree.
 */

export type Box = { x: number; y: number; width: number; height: number };

export const boxCenter = (box: Box): XY => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** Bounding box of an editor-state node (measured size, else the layout size). */
export function flowNodeBox(node: OcpnFlowNode): Box {
  const fallback = nodeSize(node);
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}

/** Bounding box of an internal (rendered) node — absolute position. */
export function internalNodeBox(node: {
  internals: { positionAbsolute: XY };
  measured?: { width?: number; height?: number };
  position: XY;
  data: unknown;
  type?: string;
}): Box {
  // Internal nodes carry the same `type`/`data` as the state nodes; only the
  // wrapper shape differs, hence the cast for the size lookup.
  const fallback = nodeSize(node as unknown as OcpnFlowNode);
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}

/**
 * Point where the segment from the box center towards `toward` leaves the
 * node: circle border for places, rectangle border for transitions.
 */
export function anchorPoint(box: Box, circle: boolean, toward: XY, pad = 1): XY {
  const c = boxCenter(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x + box.width / 2 + pad, y: c.y };
  if (circle) {
    const r = box.width / 2 + pad;
    const len = Math.hypot(dx, dy);
    return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
  }
  const hw = box.width / 2 + pad;
  const hh = box.height / 2 + pad;
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const s = Math.min(scaleX, scaleY);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * Full point sequence of an arc: source border anchor, the bend points, and
 * the target border anchor. The anchors face the neighbouring path point, so
 * an arc with bend points leaves the node towards its first bend.
 */
export function arcPathPoints(
  sourceBox: Box,
  sourceCircle: boolean,
  targetBox: Box,
  targetCircle: boolean,
  waypoints: XY[],
): XY[] {
  const start = anchorPoint(
    sourceBox,
    sourceCircle,
    waypoints[0] ?? boxCenter(targetBox),
  );
  const end = anchorPoint(
    targetBox,
    targetCircle,
    waypoints[waypoints.length - 1] ?? boxCenter(sourceBox),
  );
  return [start, ...waypoints, end];
}

/** SVG path through the points, with corners rounded at the bend points. */
export function roundedPolylinePath(points: XY[], radius = 14): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    // Clamp the rounding so short segments never overshoot.
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5 || inLen === 0 || outLen === 0) {
      d += ` L ${corner.x},${corner.y}`;
      continue;
    }
    const inX = corner.x - ((corner.x - prev.x) / inLen) * r;
    const inY = corner.y - ((corner.y - prev.y) / inLen) * r;
    const outX = corner.x + ((next.x - corner.x) / outLen) * r;
    const outY = corner.y + ((next.y - corner.y) / outLen) * r;
    d += ` L ${inX},${inY} Q ${corner.x},${corner.y} ${outX},${outY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/** Index i of the polyline segment points[i] → points[i+1] closest to `p`. */
export function nearestSegmentIndex(points: XY[], p: XY): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lenSq = abX * abX + abY * abY;
    const t =
      lenSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * abX + (p.y - a.y) * abY) / lenSq));
    const dx = p.x - (a.x + abX * t);
    const dy = p.y - (a.y + abY * t);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
