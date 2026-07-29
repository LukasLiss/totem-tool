import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, ViewportPortal } from '@xyflow/react';

import type { XY } from '@/editors/shared/model-types';

import { computeMarkerLayout, type MarkerVis } from './markers';
import {
  groupRefEquals,
  type BindingsMap,
  type GroupRef,
  type OccnEdge,
  type OccnNode,
} from './types';

const MARKER_SIZE = 12;
const OUTLINE = '#0F172A';
const MARKER_REF_ATTR = 'data-occn-marker';
const DRAG_THRESHOLD_PX = 5;

type MarkerDrag = {
  from: GroupRef;
  fromPos: XY;
  toPos: XY;
  target: GroupRef | null;
  valid: boolean;
};

/**
 * Overlay inside the flow viewport that draws the binding markers on the
 * dependency arcs plus the thin connector lines chaining the markers of one
 * AND group (which usually span different arcs of the same activity).
 *
 * Markers support two pointer gestures: a plain click selects the marker's
 * group, and dragging a marker onto another marker of the same activity side
 * merges the two groups (the drag shows a dashed preview line).
 *
 * `interactive={false}` (the read-only discovery visualizer) disables both
 * gestures but keeps pointer events on so the `<title>` tooltips still work;
 * `markerTitle` lets that caller enrich the tooltip (e.g. support counts).
 */
const MarkerOverlay = memo(function MarkerOverlay({
  nodes,
  edges,
  bindings,
  typeColors,
  parallelOffset,
  focusedGroup,
  interactive = true,
  markerTitle,
  onSelectGroup,
  onMergeGroups,
}: {
  nodes: OccnNode[];
  edges: OccnEdge[];
  bindings: BindingsMap;
  typeColors: Record<string, string>;
  parallelOffset: Record<string, number>;
  focusedGroup: GroupRef | null;
  interactive?: boolean;
  markerTitle?: (vis: MarkerVis) => string;
  onSelectGroup?: (ref: GroupRef) => void;
  onMergeGroups?: (from: GroupRef, to: GroupRef) => void;
}) {
  const { markers, lines } = useMemo(
    () => computeMarkerLayout({ nodes, edges, bindings, typeColors, parallelOffset }),
    [nodes, edges, bindings, typeColors, parallelOffset],
  );

  // Markers in crowded stacks never render labels/badges: the markers sit
  // 12–20 flow-px apart, so their labels overlap into mush at every reachable
  // zoom. The tooltips (and the visualizer's "+N" chips) carry the details.
  const labelVisible = (vis: MarkerVis) => !vis.crowded;

  const { screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<MarkerDrag | null>(null);
  const dragRef = useRef<MarkerDrag | null>(null);
  const pendingRef = useRef<{
    vis: MarkerVis;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  const updateDrag = (next: MarkerDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  // If the dragged marker disappears mid-gesture (e.g. Ctrl+Z while holding
  // the pointer), the element is unmounted and no pointerup ever reaches it —
  // drop the stale gesture instead of leaving a ghost preview line around.
  useEffect(() => {
    const from = dragRef.current?.from ?? pendingRef.current?.vis.ref;
    if (from && !markers.some((vis) => groupRefEquals(vis.ref, from))) {
      pendingRef.current = null;
      dragRef.current = null;
      setDrag(null);
    }
  }, [markers]);

  if (markers.length === 0) return null;

  const markerAtPoint = (clientX: number, clientY: number): GroupRef | null => {
    const hit = document
      .elementFromPoint(clientX, clientY)
      ?.closest(`[${MARKER_REF_ATTR}]`);
    const raw = hit?.getAttribute(MARKER_REF_ATTR);
    if (!raw) return null;
    try {
      const [activity, side, groupIndex] = JSON.parse(raw) as [
        string,
        'img' | 'omg',
        number,
      ];
      return { activity, side, groupIndex };
    } catch {
      return null;
    }
  };

  const titleFor = (vis: MarkerVis) =>
    markerTitle?.(vis) ?? defaultMarkerTitle(vis.ref.side, vis.marker[0], vis.marker[1]);

  const interactionProps = (vis: MarkerVis) => {
    if (!interactive) {
      // Pointer events stay on so the SVG <title> tooltip is reachable.
      return { style: { pointerEvents: 'all', cursor: 'default' } as const };
    }
    return staticInteractionProps(vis);
  };

  const staticInteractionProps = (vis: MarkerVis) => ({
    [MARKER_REF_ATTR]: JSON.stringify([
      vis.ref.activity,
      vis.ref.side,
      vis.ref.groupIndex,
    ]),
    className: 'nopan',
    style: { pointerEvents: 'all', cursor: 'pointer' } as const,
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onPointerDown: (event: React.PointerEvent) => {
      // One gesture at a time: a second pointer (e.g. a stray touch during a
      // marker drag) must not steal the pending state or commit the first
      // pointer's in-flight merge.
      if (event.button !== 0 || pendingRef.current !== null) return;
      event.stopPropagation();
      event.preventDefault();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      pendingRef.current = {
        vis,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    onPointerMove: (event: React.PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      const moved = Math.hypot(
        event.clientX - pending.startX,
        event.clientY - pending.startY,
      );
      if (!dragRef.current && moved < DRAG_THRESHOLD_PX) return;
      const target = markerAtPoint(event.clientX, event.clientY);
      const overOther = target !== null && !groupRefEquals(target, pending.vis.ref);
      updateDrag({
        from: pending.vis.ref,
        fromPos: pending.vis.pos,
        toPos: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        target: overOther ? target : null,
        valid:
          overOther &&
          target.activity === pending.vis.ref.activity &&
          target.side === pending.vis.ref.side,
      });
    },
    onPointerUp: (event: React.PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      pendingRef.current = null;
      event.stopPropagation();
      const active = dragRef.current;
      updateDrag(null);
      if (!active) {
        onSelectGroup?.(pending.vis.ref);
        return;
      }
      if (active.target) onMergeGroups?.(active.from, active.target);
    },
    onPointerCancel: (event: React.PointerEvent) => {
      if (pendingRef.current?.pointerId !== event.pointerId) return;
      pendingRef.current = null;
      updateDrag(null);
    },
  });

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

        {/* Merge-drag preview line */}
        {drag && (
          <line
            x1={drag.fromPos.x}
            y1={drag.fromPos.y}
            x2={drag.toPos.x}
            y2={drag.toPos.y}
            stroke={drag.valid ? '#2563EB' : 'rgba(15, 23, 42, 0.45)'}
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        )}

        {markers.map((vis) => {
          const focused = groupRefEquals(vis.ref, focusedGroup);
          const isDragSource = drag !== null && groupRefEquals(vis.ref, drag.from);
          const isDragTarget = drag?.target
            ? groupRefEquals(vis.ref, drag.target)
            : false;
          const half = MARKER_SIZE / 2;
          // Perpendicular of the tangent — labels sit beside the arc.
          const perpX = -vis.tangent.y;
          const perpY = vis.tangent.x;
          return (
            <g key={vis.id}>
              {(focused || isDragSource || isDragTarget) && (
                <circle
                  cx={vis.pos.x}
                  cy={vis.pos.y}
                  r={half + 4}
                  fill="none"
                  stroke={
                    isDragTarget
                      ? drag?.valid
                        ? '#2563EB'
                        : '#DC2626'
                      : 'rgba(37, 99, 235, 0.6)'
                  }
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
                  {...interactionProps(vis)}
                >
                  <title>{titleFor(vis)}</title>
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
                  {...interactionProps(vis)}
                >
                  <title>{titleFor(vis)}</title>
                </rect>
              )}
              {vis.cardinality && labelVisible(vis) && (
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
              {vis.keyBadge !== null && labelVisible(vis) && (
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

function defaultMarkerTitle(side: 'img' | 'omg', related: string, objectType: string) {
  return side === 'img'
    ? `input marker — from ${related} (${objectType}). Click to edit, drag onto another input marker of this activity to merge the groups.`
    : `output marker — to ${related} (${objectType}). Click to edit, drag onto another output marker of this activity to merge the groups.`;
}

export default MarkerOverlay;
