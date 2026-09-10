import type { XY } from '@/editors/shared/model-types';
import type { Box } from '@/editors/shared/arc-geometry';

import { nodeSize } from './model';
import type { OcpnFlowNode } from './types';

/**
 * OCPN-specific arc geometry on top of the shared floating-arc math
 * (editors/shared/arc-geometry): node boxes for this editor's node types
 * (circle border for places, rectangle border for transitions).
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
export function flowNodeBox(node: OcpnFlowNode): Box {
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
  const fallback = nodeSize(node as unknown as OcpnFlowNode);
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured?.width ?? fallback.width,
    height: node.measured?.height ?? fallback.height,
  };
}
