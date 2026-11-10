/**
 * Readability metrics of a finished layout (screen space): arc crossings,
 * overlapping arcs (lines on top of each other), arcs through nodes, length
 * and bends. Computed with a sweep over segment bounding boxes.
 */
import { dist, segmentHitsRect, segmentsIntersect } from './geometry';
import type { PlacedNode, Pt } from './types';

export interface MetricArc {
  id: string;
  source: string;
  target: string;
  /** Arcs with the same non-empty key are drawn together on purpose (merged). */
  groupKey?: string;
  points: Pt[];
  ctrl: Pt[];
}

interface Seg {
  arc: number;
  a: Pt;
  b: Pt;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const NEAR_NODE = 6;

export function measure(arcs: MetricArc[], nodes: PlacedNode[]) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const segs: Seg[] = [];
  arcs.forEach((arc, i) => {
    for (let k = 1; k < arc.points.length; k++) {
      const a = arc.points[k - 1];
      const b = arc.points[k];
      if (dist(a, b) < 0.01) continue;
      segs.push({
        arc: i,
        a,
        b,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      });
    }
  });
  segs.sort((s, t) => s.minX - t.minX);

  const nearEndpoint = (p: Pt, arc: MetricArc) =>
    [arc.source, arc.target].some((id) => {
      const n = nodeById.get(id);
      return (
        n && Math.abs(p.x - n.x) <= n.width / 2 + NEAR_NODE && Math.abs(p.y - n.y) <= n.height / 2 + NEAR_NODE
      );
    });

  let crossings = 0;
  const overlapLength = new Map<string, number>();
  const active: Seg[] = [];
  for (const s of segs) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].maxX < s.minX - 1) active.splice(i, 1);
    for (const o of active) {
      if (o.arc === s.arc) continue;
      if (o.maxY < s.minY - 1 || o.minY > s.maxY + 1) continue;
      const A = arcs[s.arc];
      const B = arcs[o.arc];
      if (A.groupKey && A.groupKey === B.groupKey) continue;
      if (segmentsIntersect(s.a, s.b, o.a, o.b)) {
        // Arcs meeting at a shared node are not a crossing.
        const p = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
        const shared =
          (A.source === B.source || A.source === B.target || A.target === B.source || A.target === B.target) &&
          (nearEndpoint(p, A) || nearEndpoint(p, B));
        if (!shared) crossings++;
        continue;
      }
      const ov = collinearOverlap(s, o);
      if (ov > 0) {
        const key = s.arc < o.arc ? `${s.arc}:${o.arc}` : `${o.arc}:${s.arc}`;
        overlapLength.set(key, (overlapLength.get(key) ?? 0) + ov);
      }
    }
    active.push(s);
  }
  const overlaps = [...overlapLength.values()].filter((l) => l > 8).length;

  let nodeHits = 0;
  arcs.forEach((arc) => {
    const hit = new Set<string>();
    for (let k = 1; k < arc.points.length; k++) {
      const a = arc.points[k - 1];
      const b = arc.points[k];
      for (const n of nodes) {
        if (n.id === arc.source || n.id === arc.target || hit.has(n.id)) continue;
        if (segmentHitsRect(a, b, n.x, n.y, n.width / 2 - 2, n.height / 2 - 2)) hit.add(n.id);
      }
    }
    nodeHits += hit.size;
  });

  let totalLength = 0;
  let bends = 0;
  arcs.forEach((arc) => {
    for (let k = 1; k < arc.points.length; k++) totalLength += dist(arc.points[k - 1], arc.points[k]);
    for (let k = 1; k < arc.ctrl.length - 1; k++) {
      const a = arc.ctrl[k - 1];
      const b = arc.ctrl[k];
      const c = arc.ctrl[k + 1];
      const u = { x: b.x - a.x, y: b.y - a.y };
      const v = { x: c.x - b.x, y: c.y - b.y };
      const lu = Math.hypot(u.x, u.y);
      const lv = Math.hypot(v.x, v.y);
      if (lu < 0.5 || lv < 0.5) continue;
      const cos = (u.x * v.x + u.y * v.y) / (lu * lv);
      if (cos < Math.cos((20 * Math.PI) / 180)) bends++;
    }
  });
  return { crossings, overlaps, nodeHits, totalLength: Math.round(totalLength), bends };
}

/** Length over which two nearly collinear segments lie on top of each other. */
function collinearOverlap(s: Seg, o: Seg): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1) return 0;
  const ux = dx / l;
  const uy = dy / l;
  const ox = o.b.x - o.a.x;
  const oy = o.b.y - o.a.y;
  const lo = Math.hypot(ox, oy);
  if (lo < 1) return 0;
  const sin = Math.abs(ux * oy - uy * ox) / lo;
  if (sin > 0.06) return 0;
  // Perpendicular distance of o's endpoints from s's line.
  const d1 = Math.abs((o.a.x - s.a.x) * uy - (o.a.y - s.a.y) * ux);
  const d2 = Math.abs((o.b.x - s.a.x) * uy - (o.b.y - s.a.y) * ux);
  if (Math.max(d1, d2) > 1.2) return 0;
  const p1 = (o.a.x - s.a.x) * ux + (o.a.y - s.a.y) * uy;
  const p2 = (o.b.x - s.a.x) * ux + (o.b.y - s.a.y) * uy;
  const lo1 = Math.max(0, Math.min(p1, p2));
  const hi1 = Math.min(l, Math.max(p1, p2));
  return Math.max(0, hi1 - lo1);
}
