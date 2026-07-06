import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { OccnEdgeData } from '../utils/occnTransform';

/**
 * Dependency edge between activities, ported from OCCN-Miner's CustomEdge:
 * a bezier for normal arcs (curvature fanned out for parallel edges between
 * the same pair, e.g. one arc per object type) and a hand-drawn elliptical
 * arc for self-loops, which React Flow's built-in paths cannot draw.
 */
const OccnEdge = memo(function OccnEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
  } = props;
  const data = (props.data ?? {}) as Partial<OccnEdgeData>;
  const parallelIndex = data.parallelIndex ?? 0;
  const parallelCount = data.parallelCount ?? 1;
  const title = data.dependenceMeasure != null
    ? `${data.objectType ?? ''} (dependence: ${data.dependenceMeasure.toFixed(2)})`
    : data.objectType ?? '';

  if (data.selfLoop) {
    // Source handle sits on the right of the box, target on the left, so the
    // arc sweeps over the top. Radii ported from the original; rx clamped so
    // narrow boxes still produce a visible loop, ry bumped per parallel edge.
    const rx = Math.max((sourceX - targetX) * 0.6, 40);
    const ry = 50 + parallelIndex * 14;
    const path = `M ${sourceX - 5} ${sourceY} A ${rx} ${ry} 0 1 0 ${targetX + 2} ${targetY}`;
    return (
      <g>
        <title>{title}</title>
        <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={style} />
      </g>
    );
  }

  // Fan parallel edges apart symmetrically around the default curvature.
  const spread = parallelCount > 1 ? parallelIndex - (parallelCount - 1) / 2 : 0;
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25 + spread * 0.18,
  });

  return (
    <g>
      <title>{title}</title>
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={style} />
    </g>
  );
});

export default OccnEdge;
