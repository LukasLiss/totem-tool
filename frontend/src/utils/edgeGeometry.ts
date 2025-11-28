export interface Point {
  x: number;
  y: number;
}

function clonePoints(points: Point[]): Point[] {
  return points.map(p => ({ x: p.x, y: p.y }));
}

const EPSILON = 1e-6;

function moveTowards(a: Point, b: Point, distance: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: a.x + (dx / len) * distance,
    y: a.y + (dy / len) * distance,
  };
}

export function trimPolyline(
  points: Point[],
  startOffset: number,
  endOffset: number,
): Point[] {
  if (points.length < 2) return clonePoints(points);

  let trimmed = clonePoints(points);

  if (startOffset > 0) {
    let remaining = startOffset;
    while (trimmed.length > 1 && remaining > 0) {
      const first = trimmed[0];
      const second = trimmed[1];
      const segLen = Math.hypot(second.x - first.x, second.y - first.y);
      if (segLen < EPSILON) {
        trimmed.shift();
        continue;
      }
      if (remaining < segLen) {
        trimmed[0] = moveTowards(first, second, remaining);
        break;
      }
      remaining -= segLen;
      trimmed.shift();
    }
  }

  if (endOffset > 0) {
    let remaining = endOffset;
    while (trimmed.length > 1 && remaining > 0) {
      const last = trimmed.length - 1;
      const tail = trimmed[last];
      const prev = trimmed[last - 1];
      const segLen = Math.hypot(tail.x - prev.x, tail.y - prev.y);
      if (segLen < EPSILON) {
        trimmed.pop();
        continue;
      }
      if (remaining < segLen) {
        trimmed[last] = moveTowards(tail, prev, remaining);
        break;
      }
      remaining -= segLen;
      trimmed.pop();
    }
  }

  return trimmed;
}

export function offsetPolyline(points: Point[], offset: number): Point[] {
  if (Math.abs(offset) < 1 || points.length < 2) return clonePoints(points);
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len;
  const ny = -dx / len;
  return points.map((p, idx) => {
    const t = points.length <= 1 ? 0 : idx / (points.length - 1);
    let scale = 1;
    if (Math.abs(offset) < 6) {
      const ease = 0.5 - Math.cos(Math.PI * t) / 2;
      scale = ease * 0.85 + 0.15;
    }
    return {
      x: p.x + nx * offset * scale,
      y: p.y + ny * offset * scale,
    };
  });
}

export function pointAlongPolylineFromEnd(points: Point[], distance: number): Point | null {
  if (points.length === 0 || !Number.isFinite(distance)) {
    return null;
  }
  if (distance <= 0) {
    const tip = points[points.length - 1];
    return { x: tip.x, y: tip.y };
  }

  let remaining = distance;
  for (let i = points.length - 1; i > 0; i -= 1) {
    const tail = points[i];
    const head = points[i - 1];
    const segLen = Math.hypot(tail.x - head.x, tail.y - head.y);
    if (segLen < EPSILON) {
      continue;
    }
    if (remaining <= segLen) {
      return moveTowards(tail, head, remaining);
    }
    remaining -= segLen;
  }

  const first = points[0];
  return { x: first.x, y: first.y };
}

export function smoothPolyline(points: Point[], iterations = 1): Point[] {
  if (points.length < 3 || iterations <= 0) {
    return points.map(p => ({ ...p }));
  }

  let current = points.map(p => ({ ...p }));
  for (let iter = 0; iter < iterations; iter += 1) {
    if (current.length < 3) break;
    const next: Point[] = [];
    next.push({ ...current[0] });
    for (let i = 0; i < current.length - 1; i += 1) {
      const p0 = current[i];
      const p1 = current[i + 1];
      const q = {
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25,
      };
      const r = {
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75,
      };
      next.push(q, r);
    }
    next.push({ ...current[current.length - 1] });
    current = next;
  }

  return current;
}

export function roundedPath(points: Point[], radius = 28): string {
  if (points.length < 2) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  let prevPoint = { ...points[0] };

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const next = points[i + 1];

    if (!next) {
      path += ` L ${current.x} ${current.y}`;
      break;
    }

    const v1 = { x: current.x - prevPoint.x, y: current.y - prevPoint.y };
    const v2 = { x: next.x - current.x, y: next.y - current.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);

    if (len1 === 0 || len2 === 0) {
      continue;
    }

    const cut = Math.min(radius, len1 / 2, len2 / 2);

    const entry = {
      x: current.x - (v1.x / len1) * cut,
      y: current.y - (v1.y / len1) * cut,
    };

    const exit = {
      x: current.x + (v2.x / len2) * cut,
      y: current.y + (v2.y / len2) * cut,
    };

    path += ` L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
    prevPoint = { ...exit };
  }

  return path;
}

export function sampleCubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  steps = 32,
): Point[] {
  if (steps <= 0) {
    return [
      { x: p0.x, y: p0.y },
      { x: p3.x, y: p3.y },
    ];
  }

  const result: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const a = mt2 * mt;
    const b = 3 * mt2 * t;
    const c = 3 * mt * t2;
    const d = t * t2;
    result.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return result;
}
