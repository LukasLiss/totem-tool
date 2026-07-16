import { useContext } from 'react';
import type { ConnectionLineComponentProps } from '@xyflow/react';

import { arcCubic, cubicPath, cubicTangentAt } from './geometry';
import { internalNodeBox } from './OccnEdge';
import { OccnRenderContext, type OccnNode } from './types';

const ARROW_LENGTH = 11;
const ARROW_WIDTH = 9;

/**
 * Preview line while dragging a new arc. Uses the SAME floating geometry as
 * the final edge (ray from the node center through the cursor, leaving the
 * node at its border) instead of xyflow's default handle-anchored line, so
 * the placeholder already shows where the arc will actually attach.
 */
export default function OccnConnectionLine({
  fromNode,
  toX,
  toY,
  toNode,
}: ConnectionLineComponentProps<OccnNode>) {
  const { typeColors, activeType } = useContext(OccnRenderContext);

  const sourceBox = internalNodeBox(fromNode);
  // Snap to the hovered node's border; otherwise end at the cursor (a
  // zero-size box degenerates to the point itself).
  const targetBox = toNode
    ? internalNodeBox(toNode)
    : { x: toX, y: toY, width: 0, height: 0 };
  const cubic = arcCubic(sourceBox, targetBox, 0);
  const path = cubicPath(cubic);

  // The new arc will use the object type forced by a START/END endpoint, or
  // the active type — color the preview accordingly (same precedence as
  // onConnect: forced by source, then by target, then the active type).
  const forcedFrom =
    fromNode.data.kind !== 'activity' ? fromNode.data.objectType : undefined;
  const forcedTo =
    toNode && toNode.data.kind === 'end' ? toNode.data.objectType : undefined;
  const color = typeColors[forcedFrom ?? forcedTo ?? activeType ?? ''] ?? '#64748B';

  const tip = cubic.p3;
  const tangent = cubicTangentAt(cubic, 1);
  const backX = tip.x - tangent.x * ARROW_LENGTH;
  const backY = tip.y - tangent.y * ARROW_LENGTH;
  const perpX = -tangent.y * (ARROW_WIDTH / 2);
  const perpY = tangent.x * (ARROW_WIDTH / 2);
  const arrowPoints = `${tip.x},${tip.y} ${backX + perpX},${backY + perpY} ${backX - perpX},${backY - perpY}`;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="7 5"
        strokeLinecap="round"
      />
      <polygon points={arrowPoints} fill={color} />
    </g>
  );
}
