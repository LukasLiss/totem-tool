import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

import { FALLBACK_TYPE_COLOR, type ArcFlowEdge } from './types';

/**
 * OCPN arc: smooth bezier stroked in the object type color of its place
 * endpoint. Variable arcs (F_var) are drawn as a DOUBLE line — a wide colored
 * underlay with a canvas-colored overlay reads as two parallel lines.
 */
export const ArcEdge = memo(function ArcEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<ArcFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const color = data?.color ?? FALLBACK_TYPE_COLOR;
  const variable = data?.variable === true;

  return (
    <>
      {selected && (
        <path
          d={path}
          fill="none"
          stroke="rgba(37, 99, 235, 0.35)"
          strokeWidth={variable ? 11 : 8}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* Main stroke (single line, or double-line underlay). Also carries the
          wide invisible interaction path via BaseEdge's interactionWidth. */}
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: color, strokeWidth: variable ? 7 : 2.5 }}
      />
      {variable && (
        <path
          d={path}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={2.5}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </>
  );
});

export const edgeTypes = {
  arc: ArcEdge,
};
