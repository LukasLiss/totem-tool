export interface Point {
  x: number;
  y: number;
}

function clonePoints(points: Point[]): Point[] {
  return points.map(p => ({ x: p.x, y: p.y }));
}

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
  const trimmed = clonePoints(points);
  if (startOffset > 0) {
    trimmed[0] = moveTowards(trimmed[0], trimmed[1], startOffset);
  }
  if (endOffset > 0) {
    const last = trimmed.length - 1;
    trimmed[last] = moveTowards(trimmed[last], trimmed[last - 1], endOffset);
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
