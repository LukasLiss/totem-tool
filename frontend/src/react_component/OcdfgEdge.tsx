import { memo, useMemo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { roundedPath, offsetPolyline, type Point } from '../utils/edgeGeometry';

type NodeVariant = 'start' | 'end' | 'center';

type EdgeData = {
  polyline?: Point[];
  owners?: string[];
  colors?: Record<string, string>;
  parallelIndex?: number;
  parallelCount?: number;
  sourceVariant?: NodeVariant;
  targetVariant?: NodeVariant;
};

const DEFAULT_COLOR = '#2563EB';

function computeOffset(index: number, count: number) {
  if (count <= 1) return 0;
  const spacing = 10;
  return (index - (count - 1) / 2) * spacing;
}

function buildFallbackPolyline(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): Point[] {
  const midX = (sourceX + targetX) / 2;
  return [
    { x: sourceX, y: sourceY },
    { x: midX, y: sourceY },
    { x: midX, y: targetY },
    { x: targetX, y: targetY },
  ];
}

function clampPolylineToEndpoints(points: Point[], source: Point, target: Point): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...source }];
  if (points.length === 2) return [{ ...source }, { ...target }];

  const start = points[0];
  const end = points[points.length - 1];
  const startDx = source.x - start.x;
  const startDy = source.y - start.y;
  const endDx = target.x - end.x;
  const endDy = target.y - end.y;

  const cumulative: number[] = new Array(points.length).fill(0);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
    cumulative[i] = total;
  }
  if (!Number.isFinite(total) || total <= 0) {
    total = points.length - 1;
    for (let i = 1; i < points.length; i++) {
      cumulative[i] = i;
    }
  }

  return points.map((point, index) => {
    if (index === 0) {
      return { ...source };
    }
    if (index === points.length - 1) {
      return { ...target };
    }
    const t = total > 0 ? cumulative[index] / total : index / (points.length - 1);
    return {
      x: point.x + startDx * (1 - t) + endDx * t,
      y: point.y + startDy * (1 - t) + endDy * t,
    };
  });
}

const OcdfgEdge = memo(function OcdfgEdge({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps<EdgeData>) {
  const owners = data?.owners && data.owners.length > 0 ? data.owners : ['default'];
  const colorMap = data?.colors ?? {};
  const offset = computeOffset(data?.parallelIndex ?? 0, data?.parallelCount ?? 1);

  const polyline = useMemo(() => {
    const anchored = data?.polyline && data.polyline.length >= 2
      ? clampPolylineToEndpoints(
        data.polyline,
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      )
      : buildFallbackPolyline(sourceX, sourceY, targetX, targetY);
    return offsetPolyline(anchored, offset);
  }, [data?.polyline, offset, sourceX, sourceY, targetX, targetY]);

  const path = useMemo(() => roundedPath(polyline, 30), [polyline]);
  const strokeBase = Math.max(6, owners.length * 3);
  const tailOwner = owners[0];
  const headOwner = owners[owners.length - 1];
  const tailColor = tailOwner && tailOwner !== 'default'
    ? (colorMap[tailOwner] ?? '#2563EB')
    : '#2563EB';
  const headColor = headOwner && headOwner !== 'default'
    ? (colorMap[headOwner] ?? '#2563EB')
    : '#2563EB';
  const sanitizedId = useMemo(
    () => id.replace(/[^a-zA-Z0-9_-]/g, '_'),
    [id],
  );
  const markerVariant = data?.targetVariant ?? 'default';
  const markerId = `ocdfg-arrow-${sanitizedId}-${markerVariant}`;
  const markerRefX = data?.targetVariant ? 9 : 16;
  const markerScale = Math.min(2.2, (strokeBase + 6) / 8);

  return (
    <g className="ocdfg-edge">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 20 20"
          refX={markerRefX}
          refY={10}
          markerWidth={20 * markerScale}
          markerHeight={20 * markerScale}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M2,3 L16,10 L2,17 z"
            fill={headColor}
            stroke="#F8FAFC"
            strokeWidth={Math.max(1.2, markerScale)}
            opacity={0.95}
          />
        </marker>
      </defs>

      <path
        d={path}
        fill="none"
        stroke="#CBD5E1"
        strokeWidth={strokeBase + 4}
        strokeOpacity={0.55}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {owners.map((owner, index) => {
        const color = owner === 'default'
          ? (index === owners.length - 1 ? headColor : tailColor)
          : (colorMap[owner] ?? headColor);
        const width = Math.max(2.5, strokeBase / owners.length);
        const dash = owners.length > 1 ? '10 7' : undefined;
        const dashOffset = owners.length > 1 ? index * 6 : undefined;
        return (
          <path
            key={`${id}-${owner}-${index}`}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeDasharray={dash}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd={`url(#${markerId})`}
          />
        );
      })}

      {selected && (
        <path
          d={path}
          fill="none"
          stroke={DEFAULT_COLOR}
          strokeOpacity={0.25}
          strokeWidth={strokeBase + 6}
        />
      )}
    </g>
  );
});

export default OcdfgEdge;
