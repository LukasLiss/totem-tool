import { memo } from 'react';
import { type EdgeProps, BaseEdge, getBezierPath } from '@xyflow/react';

type RelationType = 'P' | 'D' | 'I' | 'A';

type TotemEdgeData = {
  relation: RelationType;
  color?: string;
  elkPoints?: Array<{ x: number; y: number }>;
};

// --- Decorations ---

function buildDependentCap(
  tipX: number,
  tipY: number,
  normalX: number,
  normalY: number,
  scale = 1
) {
  const capLength = 16 * scale;
  const halfWidth = 8 * scale;
  
  const unitTangentX = normalY;
  const unitTangentY = -normalX;

  const baseX = tipX - normalX * capLength;
  const baseY = tipY - normalY * capLength;

  const p1x = baseX + unitTangentX * halfWidth;
  const p1y = baseY + unitTangentY * halfWidth;
  const p2x = baseX - unitTangentX * halfWidth;
  const p2y = baseY - unitTangentY * halfWidth;
  const p3x = tipX - unitTangentX * halfWidth;
  const p3y = tipY - unitTangentY * halfWidth;
  const p4x = tipX + unitTangentX * halfWidth;
  const p4y = tipY + unitTangentY * halfWidth;

  return `M ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} L ${p4x} ${p4y} Z`;
}

function buildInformationArrow(
  tipX: number,
  tipY: number,
  normalX: number,
  normalY: number,
  scale = 1
) {
  const arrowLength = 16 * scale;
  const halfWidth = 8 * scale;

  const unitTangentX = normalY;
  const unitTangentY = -normalX;

  const baseX = tipX - normalX * arrowLength;
  const baseY = tipY - normalY * arrowLength;

  const p1x = baseX + unitTangentX * halfWidth;
  const p1y = baseY + unitTangentY * halfWidth;
  const p2x = baseX - unitTangentX * halfWidth;
  const p2y = baseY - unitTangentY * halfWidth;

  return `M ${tipX} ${tipY} L ${p1x} ${p1y} L ${p2x} ${p2y} Z`;
}

const TotemEdge = memo(function TotemEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  markerEnd,
}: EdgeProps<TotemEdgeData>) {
  const relation = data?.relation ?? 'I';
  const color = data?.color ?? '#0f172a';
  const points = data?.elkPoints;

  let path = '';

  if (points && points.length > 0) {
    path = `M ${points[0].x} ${points[0].y} `;
    for (let i = 1; i < points.length; i++) {
      path += `L ${points[i].x} ${points[i].y} `;
    }
  } else {
    const [bezierPath] = getBezierPath({ sourceX, sourceY, targetX, targetY });
    path = bezierPath;
  }

  // Calculate final segment direction for decorations
  let endX = targetX;
  let endY = targetY;
  let dirX = 0;
  let dirY = -1;

  if (points && points.length >= 2) {
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    endX = last.x;
    endY = last.y;
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dirX = dx / len;
      dirY = dy / len;
    }
  }

  let capPath: string | null = null;
  let arrowPath: string | null = null;
  let parallelBars: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  if (relation === 'D') {
    capPath = buildDependentCap(endX, endY, dirX, dirY);
  } else if (relation === 'I') {
    arrowPath = buildInformationArrow(endX, endY, dirX, dirY);
  } else if (relation === 'P') {
    // Parallel bars
    const barWidth = 36;
    const barSpacing = 16;
    
    // For P relation, we draw bars perpendicular to the start and end of the edge?
    // Actually, in TotemVisualizer, they are drawn at both start and end, but for simplicity
    // we can just draw one at the start and one at the end.
    
    // Let's get start direction
    let startX = sourceX;
    let startY = sourceY;
    let sDirX = 0;
    let sDirY = 1;
    if (points && points.length >= 2) {
      const first = points[0];
      const second = points[1];
      startX = first.x;
      startY = first.y;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        sDirX = dx / len;
        sDirY = dy / len;
      }
    }

    const startTangentX = sDirY;
    const startTangentY = -sDirX;
    parallelBars.push({
      x1: startX - startTangentX * barWidth / 2,
      y1: startY - startTangentY * barWidth / 2,
      x2: startX + startTangentX * barWidth / 2,
      y2: startY + startTangentY * barWidth / 2,
    });

    const endTangentX = dirY;
    const endTangentY = -dirX;
    parallelBars.push({
      x1: endX - endTangentX * barWidth / 2,
      y1: endY - endTangentY * barWidth / 2,
      x2: endX + endTangentX * barWidth / 2,
      y2: endY + endTangentY * barWidth / 2,
    });
  }

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={{ ...style, strokeWidth: 2, stroke: color }} />
      {capPath && <path d={capPath} fill={color} />}
      {arrowPath && <path d={arrowPath} fill={color} />}
      {parallelBars.map((bar, i) => (
        <line
          key={i}
          x1={bar.x1}
          y1={bar.y1}
          x2={bar.x2}
          y2={bar.y2}
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
        />
      ))}
    </>
  );
});

export default TotemEdge;
