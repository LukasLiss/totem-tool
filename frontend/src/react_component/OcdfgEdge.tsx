import { memo, useMemo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { roundedPath, offsetPolyline, type Point } from '../utils/edgeGeometry';

type EdgeData = {
  polyline?: Point[];
  owners?: string[];
  colors?: Record<string, string>;
  parallelIndex?: number;
  parallelCount?: number;
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
    if (data?.polyline && data.polyline.length >= 2) {
      return offsetPolyline(data.polyline, offset);
    }
    return offsetPolyline(buildFallbackPolyline(sourceX, sourceY, targetX, targetY), offset);
  }, [data?.polyline, offset, sourceX, sourceY, targetX, targetY]);

  const path = useMemo(() => roundedPath(polyline, 30), [polyline]);
  const strokeBase = Math.max(6, owners.length * 3);
  const arrowColor = owners[owners.length - 1] === 'default'
    ? DEFAULT_COLOR
    : (colorMap[owners[owners.length - 1]] ?? DEFAULT_COLOR);
  const markerId = `ocdfg-arrow-${id}`;
  const markerStartId = `ocdfg-arrow-start-${id}`;

  return (
    <g className="ocdfg-edge">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 24 24"
          refX={20}
          refY={12}
          markerWidth={22}
          markerHeight={22}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M2,4 L20,12 L2,20 z"
            fill={arrowColor}
            stroke="#F8FAFC"
            strokeWidth={2}
            opacity={0.95}
          />
        </marker>
        <marker
          id={markerStartId}
          viewBox="0 0 24 24"
          refX={4}
          refY={12}
          markerWidth={18}
          markerHeight={18}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M22,4 L4,12 L22,20 z"
            fill={arrowColor}
            stroke="#F1F5F9"
            strokeWidth={1.5}
            opacity={0.45}
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
        const color = owner === 'default' ? DEFAULT_COLOR : (colorMap[owner] ?? DEFAULT_COLOR);
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
            markerStart={index === 0 ? `url(#${markerStartId})` : undefined}
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
