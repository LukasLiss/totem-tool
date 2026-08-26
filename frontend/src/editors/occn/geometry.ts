import type { XY } from '@/editors/shared/model-types';

/**
 * Shared bezier geometry for dependency arcs. The custom edge builds its SVG
 * path from these control points and the marker overlay evaluates the SAME
 * cubic at parameter t, so markers always sit exactly on the drawn arc.
 */

export type Box = { x: number; y: number; width: number; height: number };

export type Cubic = { p0: XY; p1: XY; p2: XY; p3: XY };

const centerOf = (box: Box): XY => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** Point where the ray from the box center towards `towards` leaves the box. */
function borderPoint(box: Box, towards: XY, pad = 2): XY {
  const c = centerOf(box);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  const hw = box.width / 2 + pad;
  const hh = box.height / 2 + pad;
  if (dx === 0 && dy === 0) return { x: c.x + hw, y: c.y };
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const s = Math.min(scaleX, scaleY);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Base clearance of a self-loop above the node (marker labels need room). */
const SELF_LOOP_BASE = 70;

/**
 * Self-loop over the top of the node: leaves the top edge right of center,
 * arcs `SELF_LOOP_BASE + offset` above the node and re-enters left of center.
 * `offset` must be non-negative (parallel self-loops stack upwards); t≈0.15
 * lands on the ascending right side (output markers) and t≈0.85 on the
 * descending left side (input markers), matching normal arcs.
 */
function selfLoopCubic(box: Box, offset: number): Cubic {
  const cx = box.x + box.width / 2;
  const top = box.y - 2;
  const h = SELF_LOOP_BASE + Math.max(0, offset);
  return {
    p0: { x: cx + box.width / 4, y: top },
    p1: { x: cx + box.width * 0.8, y: top - h },
    p2: { x: cx - box.width * 0.8, y: top - h },
    p3: { x: cx - box.width / 4, y: top },
  };
}

/**
 * Cubic bezier for the arc source → target. `offset` is a signed perpendicular
 * offset (flow units) used to fan out parallel arcs between the same pair of
 * activities; 0 yields a straight line. Coinciding boxes (a self-dependency,
 * which discovered nets contain) yield a loop over the top of the node.
 */
export function arcCubic(source: Box, target: Box, offset: number): Cubic {
  if (
    source === target ||
    (source.x === target.x &&
      source.y === target.y &&
      source.width === target.width &&
      source.height === target.height)
  ) {
    return selfLoopCubic(source, offset);
  }
  const sc = centerOf(source);
  const tc = centerOf(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const len = Math.hypot(dx, dy) || 1;
  const perp = { x: -dy / len, y: dx / len };
  const mid = {
    x: (sc.x + tc.x) / 2 + perp.x * offset,
    y: (sc.y + tc.y) / 2 + perp.y * offset,
  };
  // Quadratic control point (apex of the curve passes through `mid`).
  const q = {
    x: (sc.x + tc.x) / 2 + perp.x * offset * 2,
    y: (sc.y + tc.y) / 2 + perp.y * offset * 2,
  };
  const p0 = borderPoint(source, mid);
  const p3 = borderPoint(target, mid);
  // Elevate the quadratic (p0, q, p3) to a cubic.
  const p1 = { x: p0.x + ((q.x - p0.x) * 2) / 3, y: p0.y + ((q.y - p0.y) * 2) / 3 };
  const p2 = { x: p3.x + ((q.x - p3.x) * 2) / 3, y: p3.y + ((q.y - p3.y) * 2) / 3 };
  return { p0, p1, p2, p3 };
}

export function cubicPointAt({ p0, p1, p2, p3 }: Cubic, t: number): XY {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Normalised tangent of the cubic at t (falls back to the chord). */
export function cubicTangentAt({ p0, p1, p2, p3 }: Cubic, t: number): XY {
  const u = 1 - t;
  let dx =
    3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  let dy =
    3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  if (dx === 0 && dy === 0) {
    dx = p3.x - p0.x;
    dy = p3.y - p0.y;
  }
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function cubicPath({ p0, p1, p2, p3 }: Cubic): string {
  return `M ${p0.x},${p0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
}
