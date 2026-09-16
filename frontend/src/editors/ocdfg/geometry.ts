import type { XY } from '@/editors/shared/model-types';
import { boxCenter, type Box } from '@/editors/shared/arc-geometry';

import { nodeSize } from './model';
import type { OcdfgFlowNode } from './types';

/**
 * OC-DFG-specific arc geometry on top of the shared floating-arc math
 * (editors/shared/arc-geometry): node boxes for this editor's node types
 * (circle border for START/END nodes, rectangle border for activities) and
 * the derived routing for self-loops and parallel arcs.
 */

export {
  anchorPoint,
  arcPathPoints,
  boxCenter,
  nearestSegmentIndex,
  roundedPolylinePath,
  type Box,
} from '@/editors/shared/arc-geometry';

/** Bounding box of an editor-state node (measured size, else the layout size). */
export function flowNodeBox(node: OcdfgFlowNode): Box {
  const fallback = nodeSize(node);
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}

/** Bounding box of an internal (rendered) node — absolute position. */
export function internalNodeBox(node: {
  internals: { positionAbsolute: XY };
  measured?: { width?: number; height?: number };
  position: XY;
  data: unknown;
  type?: string;
}): Box {
  // Internal nodes carry the same `type`/`data` as the state nodes; only the
  // wrapper shape differs, hence the cast for the size lookup.
  const fallback = nodeSize(node as unknown as OcdfgFlowNode);
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}

/** Synthetic bend points of a self-loop; `loopIndex` stacks loops outwards. */
export function selfLoopWaypoints(box: Box, loopIndex = 0): XY[] {
  const c = boxCenter(box);
  const reach = box.width / 2 + 40 + loopIndex * 28;
  const spread = 24 + loopIndex * 6;
  return [
    { x: c.x + reach, y: c.y - spread },
    { x: c.x + reach, y: c.y + spread },
  ];
}

/**
 * Effective bend points used for drawing: the user's bend points if there are
 * any, otherwise the derived routing (self-loop points, or a single offset
 * midpoint for parallel arcs between the same pair of nodes).
 */
export function effectiveWaypoints(
  sourceBox: Box,
  targetBox: Box,
  selfLoop: boolean,
  waypoints: XY[],
  parallelOffset: number,
  loopIndex: number,
): XY[] {
  if (waypoints.length > 0) return waypoints;
  if (selfLoop) return selfLoopWaypoints(sourceBox, loopIndex);
  if (parallelOffset !== 0) {
    const a = boxCenter(sourceBox);
    const b = boxCenter(targetBox);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Perpendicular offset of the midpoint separates parallel arcs.
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    return [
      { x: (a.x + b.x) / 2 + nx * parallelOffset, y: (a.y + b.y) / 2 + ny * parallelOffset },
    ];
  }
  return [];
}
