import { memo, useMemo } from 'react';
import { ViewportPortal } from '@xyflow/react';

import { computeMarkerLayout } from './markers';
import {
  groupRefEquals,
  type BindingsMap,
  type GroupRef,
  type OccnEdge,
  type OccnNode,
} from './types';

const MARKER_SIZE = 12;
const OUTLINE = '#0F172A';

/**
 * Overlay inside the flow viewport that draws the binding markers on the
 * dependency arcs plus the thin connector lines chaining the markers of one
 * AND group (which usually span different arcs of the same activity).
 */
const MarkerOverlay = memo(function MarkerOverlay({
  nodes,
  edges,
  bindings,
  typeColors,
  parallelOffset,
  focusedGroup,
  onSelectGroup,
}: {
  nodes: OccnNode[];
  edges: OccnEdge[];
  bindings: BindingsMap;
  typeColors: Record<string, string>;
  parallelOffset: Record<string, number>;
  focusedGroup: GroupRef | null;
  onSelectGroup: (ref: GroupRef) => void;
}) {
  const { markers, lines } = useMemo(
    () => computeMarkerLayout({ nodes, edges, bindings, typeColors, parallelOffset }),
    [nodes, edges, bindings, typeColors, parallelOffset],
  );

  if (markers.length === 0) return null;

  return (
    <ViewportPortal>
      <svg
        width={2}
        height={2}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 900,
        }}
      >
        {/* AND-group connector lines (below the markers) */}
        {lines.map((line) => {
          const focused = groupRefEquals(line.ref, focusedGroup);
          return (
            <polyline
              key={line.id}
              points={line.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={focused ? '#2563EB' : 'rgba(15, 23, 42, 0.7)'}
              strokeWidth={focused ? 2 : 1.2}
            />
          );
        })}

        {markers.map((vis) => {
          const focused = groupRefEquals(vis.ref, focusedGroup);
          const half = MARKER_SIZE / 2;
          // Perpendicular of the tangent — labels sit beside the arc.
          const perpX = -vis.tangent.y;
          const perpY = vis.tangent.x;
          return (
            <g key={vis.id}>
              {focused && (
                <circle
                  cx={vis.pos.x}
                  cy={vis.pos.y}
                  r={half + 4}
                  fill="none"
                  stroke="rgba(37, 99, 235, 0.6)"
                  strokeWidth={2.5}
                />
              )}
              {vis.shape === 'circle' ? (
                <circle
                  cx={vis.pos.x}
                  cy={vis.pos.y}
                  r={half}
                  fill={vis.color}
                  stroke={OUTLINE}
                  strokeWidth={1.5}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectGroup(vis.ref);
                  }}
                >
                  <title>{markerTitle(vis.ref.side, vis.marker[0], vis.marker[1])}</title>
                </circle>
              ) : (
                <rect
                  x={vis.pos.x - half}
                  y={vis.pos.y - half}
                  width={MARKER_SIZE}
                  height={MARKER_SIZE}
                  fill={vis.color}
                  stroke={OUTLINE}
                  strokeWidth={1.5}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectGroup(vis.ref);
                  }}
                >
                  <title>{markerTitle(vis.ref.side, vis.marker[0], vis.marker[1])}</title>
                </rect>
              )}
              {vis.cardinality && (
                <text
                  x={vis.pos.x + perpX * 15}
                  y={vis.pos.y + perpY * 15}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    fill: OUTLINE,
                    paintOrder: 'stroke',
                    stroke: 'rgba(255, 255, 255, 0.8)',
                    strokeWidth: 3,
                    pointerEvents: 'none',
                  }}
                >
                  {vis.cardinality}
                </text>
              )}
              {vis.keyBadge !== null && (
                <g
                  transform={`translate(${vis.pos.x - perpX * 14}, ${vis.pos.y - perpY * 14})`}
                  style={{ pointerEvents: 'none' }}
                >
                  <rect x={-6.5} y={-5.5} width={13} height={11} rx={3} fill={OUTLINE} />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ fontSize: 8, fontWeight: 700, fill: '#FFFFFF' }}
                  >
                    {vis.keyBadge}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
});

function markerTitle(side: 'img' | 'omg', related: string, objectType: string) {
  return side === 'img'
    ? `input marker — from ${related} (${objectType})`
    : `output marker — to ${related} (${objectType})`;
}

export default MarkerOverlay;
