import { memo, useContext } from 'react';
import { BaseEdge, useInternalNode, type EdgeProps } from '@xyflow/react';

import { arcCubic, cubicPath, cubicTangentAt, type Box } from './geometry';
import {
  nodeFallbackSize,
  OccnRenderContext,
  type OccnEdge,
  type OccnNode,
  type OccnNodeData,
} from './types';

export function internalNodeBox(node: {
  internals: { positionAbsolute: { x: number; y: number } };
  measured?: { width?: number; height?: number };
  data: unknown;
}): Box {
  const kind = (node.data as OccnNodeData | undefined)?.kind ?? 'activity';
  const fallback = nodeFallbackSize(kind);
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}

const ARROW_LENGTH = 11;
const ARROW_WIDTH = 9;

const OccnEdgeComponent = memo(function OccnEdgeComponent({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<OccnEdge>) {
  const { typeColors, parallelOffset } = useContext(OccnRenderContext);
  const sourceNode = useInternalNode<OccnNode>(source);
  const targetNode = useInternalNode<OccnNode>(target);
  if (!sourceNode || !targetNode) return null;

  const cubic = arcCubic(
    internalNodeBox(sourceNode),
    internalNodeBox(targetNode),
    parallelOffset[id] ?? 0,
  );
  const path = cubicPath(cubic);
  const color = typeColors[data?.objectType ?? ''] ?? '#64748B';

  // Solid arrowhead at the target end, oriented along the curve tangent.
  const tip = cubic.p3;
  const tangent = cubicTangentAt(cubic, 1);
  const backX = tip.x - tangent.x * ARROW_LENGTH;
  const backY = tip.y - tangent.y * ARROW_LENGTH;
  const perpX = -tangent.y * (ARROW_WIDTH / 2);
  const perpY = tangent.x * (ARROW_WIDTH / 2);
  const arrowPoints = `${tip.x},${tip.y} ${backX + perpX},${backY + perpY} ${backX - perpX},${backY - perpY}`;

  // The discovery visualizer sets dependenceMeasure; the editor leaves it
  // undefined, so editor arcs get no tooltip (behavior unchanged).
  const tooltip =
    data?.dependenceMeasure === undefined
      ? null
      : `${data?.objectType ?? ''}${
          data?.dependenceMeasure != null
            ? ` — dependence: ${data.dependenceMeasure.toFixed(2)}`
            : ''
        }`;

  return (
    <g>
      {tooltip && <title>{tooltip}</title>}
      {selected && (
        <path
          d={path}
          fill="none"
          stroke="rgba(37, 99, 235, 0.35)"
          strokeWidth={8}
          strokeLinecap="round"
        />
      )}
      <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: 2 }} />
      <polygon points={arrowPoints} fill={color} style={{ pointerEvents: 'none' }} />
    </g>
  );
});

export default OccnEdgeComponent;
