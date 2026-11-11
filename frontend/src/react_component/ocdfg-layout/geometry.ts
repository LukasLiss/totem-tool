/** Polyline geometry used by the router and the renderer. */
import type { Pt } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, steps = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

export function quadratic(p0: Pt, c: Pt, p1: Pt, steps = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y });
  }
  return out;
}

/** Remove consecutive duplicates and collinear interior points. */
export function simplify(points: Pt[], eps = 0.01): Pt[] {
  const dedup: Pt[] = [];
  for (const p of points) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.abs(last.x - p.x) > eps || Math.abs(last.y - p.y) > eps) dedup.push(p);
  }
  if (dedup.length < 3) return dedup;
  const out: Pt[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) > eps * 10 || dot < 0) out.push(b);
  }
  out.push(dedup[dedup.length - 1]);
  return out;
}

/** Replace sharp corners by circular arcs of radius `r` (sampled). */
export function roundCorners(points: Pt[], r: number, steps = 6): Pt[] {
  const pts = simplify(points);
  if (r <= 0 || pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const la = dist(a, p);
    const lb = dist(p, b);
    const rr = Math.min(r, la / 2, lb / 2);
    if (rr < 0.5) {
      out.push(p);
      continue;
    }
    const s = { x: p.x + ((a.x - p.x) / la) * rr, y: p.y + ((a.y - p.y) / la) * rr };
    const e = { x: p.x + ((b.x - p.x) / lb) * rr, y: p.y + ((b.y - p.y) / lb) * rr };
    // Quadratic through the corner approximates the arc closely enough.
    quadratic(s, p, e, steps).forEach((q) => out.push(q));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Catmull-Rom spline through the points, sampled. */
export function catmullRom(points: Pt[], steps = 10): Pt[] {
  const pts = simplify(points);
  if (pts.length < 3) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    const seg = cubic(p1, c1, c2, p2, steps);
    if (i > 0) seg.shift();
    out.push(...seg);
  }
  return out;
}

/**
 * Smooth flow curve: between points on different "levels" (flow coordinate y)
 * an S-curve with tangents along the flow; aligned points are joined
 * straight. The first and last tangents follow the given normals.
 */
export function flowCurve(points: Pt[], startDir: Pt, endDir: Pt, steps = 12): Pt[] {
  const pts = simplify(points, 0.001);
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (Math.abs(a.x - b.x) < 0.5 && (i > 0 || startDir.x === 0) && (i < pts.length - 2 || endDir.x === 0)) {
      out.push(b);
      continue;
    }
    const d = Math.max(12, Math.min(dist(a, b) * 0.5, Math.abs(b.y - a.y) * 0.6 + 12));
    const ta = i === 0 ? startDir : { x: 0, y: Math.sign(b.y - a.y) || 1 };
    const tb = i === pts.length - 2 ? endDir : { x: 0, y: Math.sign(b.y - a.y) || 1 };
    const seg = cubic(a, { x: a.x + ta.x * d, y: a.y + ta.y * d }, { x: b.x - tb.x * d, y: b.y - tb.y * d }, b, steps);
    seg.shift();
    out.push(...seg);
  }
  return out;
}

/** Parallel copy of a polyline at signed distance `d` (right-hand side positive). */
export function offsetPolyline(points: Pt[], d: number | ((t: number) => number)): Pt[] {
  if (points.length < 2) return points;
  const f = typeof d === 'number' ? () => d : d;
  if (typeof d === 'number' && d === 0) return points;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]));
  const total = lengths[lengths.length - 1] || 1;
  const normal = (a: Pt, b: Pt) => {
    const l = dist(a, b) || 1;
    // Right-hand normal of the travel direction (screen coordinates, y down).
    return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  };
  return points.map((p, i) => {
    const off = f(lengths[i] / total);
    let n: Pt;
    if (i === 0) n = normal(points[0], points[1]);
    else if (i === points.length - 1) n = normal(points[i - 1], points[i]);
    else {
      const n1 = normal(points[i - 1], p);
      const n2 = normal(p, points[i + 1]);
      const sum = { x: n1.x + n2.x, y: n1.y + n2.y };
      const l = Math.hypot(sum.x, sum.y);
      if (l < 1e-6) n = n1;
      else {
        const m = { x: sum.x / l, y: sum.y / l };
        const cos = m.x * n1.x + m.y * n1.y;
        const scale = 1 / Math.max(0.35, cos);
        n = { x: m.x * scale, y: m.y * scale };
      }
    }
    return { x: p.x + n.x * off, y: p.y + n.y * off };
  });
}

/** Resample a polyline to roughly `n` evenly spaced points (keeps the ends). */
export function resample(points: Pt[], n: number): Pt[] {
  if (points.length < 2) return points;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]));
  const total = lengths[lengths.length - 1];
  if (total === 0) return points;
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * total;
    while (j < lengths.length - 2 && lengths[j + 1] < target) j++;
    const seg = lengths[j + 1] - lengths[j] || 1;
    const t = (target - lengths[j]) / seg;
    out.push({ x: points[j].x + (points[j + 1].x - points[j].x) * t, y: points[j].y + (points[j + 1].y - points[j].y) * t });
  }
  return out;
}

export function polylineLength(points: Pt[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

/** Point and direction at fraction `t` of the polyline's length. */
export function pointAt(points: Pt[], t: number): { p: Pt; dir: Pt } {
  if (points.length === 0) return { p: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
  if (points.length === 1) return { p: points[0], dir: { x: 1, y: 0 } };
  const total = polylineLength(points);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < points.length; i++) {
    const l = dist(points[i - 1], points[i]);
    if (target <= l || i === points.length - 1) {
      const f = l ? Math.min(1, target / l) : 0;
      const a = points[i - 1];
      const b = points[i];
      return {
        p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
        dir: { x: (b.x - a.x) / (l || 1), y: (b.y - a.y) / (l || 1) },
      };
    }
    target -= l;
  }
  return { p: points[points.length - 1], dir: { x: 1, y: 0 } };
}

/** Shorten the end of a polyline by `len` (for arrow heads). */
export function trimEnd(points: Pt[], len: number): Pt[] {
  if (len <= 0 || points.length < 2) return points;
  const out = [...points];
  let remaining = len;
  while (out.length >= 2) {
    const b = out[out.length - 1];
    const a = out[out.length - 2];
    const l = dist(a, b);
    if (l > remaining) {
      out[out.length - 1] = { x: b.x - ((b.x - a.x) / l) * remaining, y: b.y - ((b.y - a.y) / l) * remaining };
      return out;
    }
    remaining -= l;
    out.pop();
    if (out.length < 2) return [a, a];
  }
  return out;
}

/** Point where the ray from the rectangle's center towards `toward` leaves it. */
export function clipToRect(center: Pt, halfW: number, halfH: number, toward: Pt): Pt {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const sx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return { x: center.x + dx * s, y: center.y + dy * s };
}

/** Proper intersection of segments ab and cd. */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function intersectionPoint(a: Pt, b: Pt, c: Pt, d: Pt): Pt {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (den === 0) return a;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Does segment ab pass through the rectangle (center, half sizes)? */
export function segmentHitsRect(a: Pt, b: Pt, cx: number, cy: number, hw: number, hh: number): boolean {
  // Liang–Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: Array<[number, number]> = [
    [-dx, a.x - (cx - hw)],
    [dx, cx + hw - a.x],
    [-dy, a.y - (cy - hh)],
    [dy, cy + hh - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 - t0 > 1e-6;
}

/** SVG path data of a polyline. */
export function pathD(points: Pt[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i].x.toFixed(2)},${points[i].y.toFixed(2)}`;
  return d;
}
