import { memo, useContext, useRef } from 'react';
import {
  BaseEdge,
  useInternalNode,
  useReactFlow,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from '@xyflow/react';

import {
  anchorPoint,
  arcPathPoints,
  boxCenter,
  effectiveWaypoints,
  internalNodeBox,
  roundedPolylinePath,
} from './geometry';
import {
  ActiveTypeColorContext,
  FALLBACK_TYPE_COLOR,
  OcdfgEdgeApiContext,
  type ArcFlowEdge,
  type OcdfgFlowNode,
} from './types';

/**
 * OC-DFG arc: a floating edge colored by its object type that attaches to the
 * node border facing the next path point (circle border for START/END nodes,
 * rectangle border for activities), optionally routed through draggable bend
 * points. Self-loops and parallel arcs between the same nodes are routed
 * apart automatically as long as they have no user bend points.
 *
 * Bend points: double-click the arc to add one (handled by the editor),
 * drag a bend point to move it, double-click a bend point to remove it.
 */
export const ArcEdge = memo(function ArcEdge({
  id,
  source,
  target,
  data,
  markerEnd,
  selected,
}: EdgeProps<ArcFlowEdge>) {
  const sourceNode = useInternalNode<OcdfgFlowNode>(source);
  const targetNode = useInternalNode<OcdfgFlowNode>(target);
  const api = useContext(OcdfgEdgeApiContext);
  const { screenToFlowPosition } = useReactFlow();
  // In-flight bend-point drag: bound to one pointer, and only active once the
  // pointer moved a few pixels so sloppy clicks don't nudge the point.
  const waypointDragRef = useRef<{
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  if (!sourceNode || !targetNode) return null;

  const sourceBox = internalNodeBox(sourceNode);
  const targetBox = internalNodeBox(targetNode);
  const waypoints = data?.waypoints ?? [];
  const routed = effectiveWaypoints(
    sourceBox,
    targetBox,
    source === target,
    waypoints,
    data?.parallelOffset ?? 0,
    data?.loopIndex ?? 0,
  );
  const points = arcPathPoints(
    sourceBox,
    sourceNode.type === 'control',
    targetBox,
    targetNode.type === 'control',
    routed,
  );
  const path = roundedPolylinePath(points, source === target ? 22 : 14);

  const color = data?.color ?? FALLBACK_TYPE_COLOR;

  return (
    <>
      {selected && (
        <path
          d={path}
          fill="none"
          stroke="rgba(37, 99, 235, 0.35)"
          strokeWidth={8}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* Main stroke; also carries the wide invisible interaction path via
          BaseEdge's interactionWidth. */}
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: color, strokeWidth: 2.5 }}
      />
      {waypoints.map((waypoint, index) => (
        <circle
          key={index}
          className="nopan nodrag"
          cx={waypoint.x}
          cy={waypoint.y}
          r={selected ? 5.5 : 4}
          fill="#FFFFFF"
          stroke={color}
          strokeWidth={selected ? 2.5 : 2}
          style={{ pointerEvents: 'all', cursor: 'grab' }}
          onPointerDown={(event) => {
            if (event.button !== 0 || waypointDragRef.current !== null) return;
            event.stopPropagation();
            event.preventDefault();
            (event.currentTarget as Element).setPointerCapture(event.pointerId);
            waypointDragRef.current = {
              index,
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              active: false,
            };
            api?.beginWaypointDrag();
          }}
          onPointerMove={(event) => {
            const drag = waypointDragRef.current;
            if (
              !drag ||
              drag.index !== index ||
              drag.pointerId !== event.pointerId ||
              !(event.currentTarget as Element).hasPointerCapture(event.pointerId)
            ) {
              return;
            }
            if (
              !drag.active &&
              Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3
            ) {
              return;
            }
            drag.active = true;
            api?.moveWaypoint(
              id,
              index,
              screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            );
          }}
          onPointerUp={(event) => {
            const drag = waypointDragRef.current;
            if (!drag || drag.index !== index || drag.pointerId !== event.pointerId) {
              return;
            }
            event.stopPropagation();
            waypointDragRef.current = null;
            api?.endWaypointDrag();
          }}
          onPointerCancel={(event) => {
            const drag = waypointDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            // Keep whatever moves already applied as one undo step — same
            // outcome as releasing the pointer at the cancel position.
            waypointDragRef.current = null;
            api?.endWaypointDrag();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            api?.removeWaypoint(id, index);
          }}
        >
          <title>Bend point — drag to move, double-click to remove</title>
        </circle>
      ))}
    </>
  );
});

/**
 * Preview line while dragging a new arc: same floating border-anchor geometry
 * as the final edge (red when hovering an invalid target).
 */
export function ArcConnectionLine({
  fromNode,
  toX,
  toY,
  toNode,
  connectionStatus,
}: ConnectionLineComponentProps<OcdfgFlowNode>) {
  const activeTypeColor = useContext(ActiveTypeColorContext);
  const sourceBox = internalNodeBox(fromNode);
  const cursor = { x: toX, y: toY };
  const targetBox = toNode ? internalNodeBox(toNode) : null;
  const towards = targetBox ? boxCenter(targetBox) : cursor;
  const start = anchorPoint(sourceBox, fromNode.type === 'control', towards);
  const end =
    targetBox && toNode
      ? anchorPoint(targetBox, toNode.type === 'control', boxCenter(sourceBox))
      : cursor;

  const controlEndpoint =
    fromNode.type === 'control' ? fromNode : toNode?.type === 'control' ? toNode : null;
  const controlColor = controlEndpoint
    ? (controlEndpoint.data as { color?: string }).color
    : undefined;
  // A control endpoint pins the type; otherwise the active type decides.
  const color =
    connectionStatus === 'invalid' ? '#DC2626' : (controlColor ?? activeTypeColor);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const arrowLength = 11;
  const arrowWidth = 9;
  const backX = end.x - ux * arrowLength;
  const backY = end.y - uy * arrowLength;
  const perpX = -uy * (arrowWidth / 2);
  const perpY = ux * (arrowWidth / 2);

  return (
    <g style={{ pointerEvents: 'none' }}>
      <path
        d={`M ${start.x},${start.y} L ${end.x},${end.y}`}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="7 5"
        strokeLinecap="round"
      />
      <polygon
        points={`${end.x},${end.y} ${backX + perpX},${backY + perpY} ${backX - perpX},${backY - perpY}`}
        fill={color}
      />
    </g>
  );
}

export const edgeTypes = {
  arc: ArcEdge,
};
