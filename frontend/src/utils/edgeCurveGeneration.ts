/**
 * Edge Curve Generation Utilities
 *
 * Extracted from GraphLayouter.tsx to enable reuse in real-time dynamic edge routing.
 * Contains sophisticated collision detection and smooth Bezier curve generation logic.
 */

import { sampleCubicBezier, type Point } from './edgeGeometry';

// ========== CONSTANTS ==========
// Extracted from GraphLayouter.tsx lines 100-104

export const BUFFER_ZONE_MARGIN = 45;
export const BUFFER_REPULSION_RADIUS = BUFFER_ZONE_MARGIN + 30; // 75
export const LONGEST_TRACE_BEZIER_SAMPLES = 32;
export const LONGEST_TRACE_BEZIER_HANDLE_SCALE = 1.35;

// ========== TYPES ==========

export interface BufferRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type { Point };

// ========== CORE FUNCTIONS ==========

/**
 * Detects collisions and generates waypoints to avoid obstacles.
 * Extracted from GraphLayouter.tsx lines 753-952 - NO CHANGES.
 *
 * This is the sophisticated algorithm that creates smooth curves by:
 * - Sampling edges at 6 points for collision detection
 * - Generating 1-4 waypoints with sine easing
 * - Using repulsion from blocking nodes
 * - Two-stage refinement for deep penetration
 */
export function relaxPolylineAroundBuffers(
  polyline: Point[],
  buffers: BufferRect[],
  sourceId?: string,
  targetId?: string,
): Point[] {
  if (polyline.length < 2 || buffers.length === 0) {
    return polyline.map(p => ({ ...p }));
  }

  // Only adjust simple straight edges; keep special polylines (e.g. cycles) as-is.
  if (polyline.length !== 2) {
    return polyline.map(p => ({ ...p }));
  }

  const [src, tgt] = polyline;
  const allowedBuffers = buffers.filter(b => b.id !== sourceId && b.id !== targetId);
  if (allowedBuffers.length === 0) {
    return polyline.map(p => ({ ...p }));
  }

  const vx = tgt.x - src.x;
  const vy = tgt.y - src.y;
  const segLen = Math.hypot(vx, vy);
  if (!Number.isFinite(segLen) || segLen < 1e-3) {
    return polyline.map(p => ({ ...p }));
  }

  // Sample along the straight edge to detect which buffers it actually crosses.
  const sampleTs = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
  const blockers: BufferRect[] = [];
  const hitCounts = new Map<string, number>();

  const isInside = (px: number, py: number, rect: BufferRect, pad = 4) =>
    px >= rect.left - pad
    && px <= rect.right + pad
    && py >= rect.top - pad
    && py <= rect.bottom + pad;

  allowedBuffers.forEach((rect) => {
    let hits = 0;
    sampleTs.forEach((t) => {
      const sx = src.x + vx * t;
      const sy = src.y + vy * t;
      if (isInside(sx, sy, rect)) {
        hits += 1;
      }
    });
    if (hits > 0) {
      blockers.push(rect);
      hitCounts.set(rect.id, hits);
    }
  });

  if (blockers.length === 0) {
    return polyline.map(p => ({ ...p }));
  }

  const longEdge = segLen > BUFFER_ZONE_MARGIN * 4;
  const multiBlocker = blockers.length >= 2;
  const spansBuffer = Array.from(hitCounts.values()).some(c => c >= 2);
  const needsStrongerCurve = longEdge || multiBlocker || spansBuffer;

  // Determine sideways direction that moves the edge away from blocking buffers.
  const midForDirection = {
    x: src.x + vx * 0.5,
    y: src.y + vy * 0.5,
  };
  let dirX = 0;
  let dirY = 0;
  blockers.forEach((rect) => {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    dirX += midForDirection.x - cx;
    dirY += midForDirection.y - cy;
  });

  // If blockers are symmetric, fall back to a stable perpendicular.
  if (Math.hypot(dirX, dirY) < 1e-3) {
    dirX = -vy;
    dirY = vx;
  }

  const dirLen = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / dirLen;
  const ny = dirY / dirLen;

  const baseOffset = BUFFER_REPULSION_RADIUS;
  const offset = needsStrongerCurve ? baseOffset * 1.6 : baseOffset * 1.15;

  // Longer edges get more bend points; each bend is eased so that
  // the maximum offset is near the middle of the edge and fades
  // smoothly towards the endpoints.
  const lengthFactor = segLen / (BUFFER_ZONE_MARGIN * (needsStrongerCurve ? 1.3 : 1.8));
  const maxSegments = needsStrongerCurve ? 4 : 3;
  const minSegments = needsStrongerCurve ? 2 : 1;
  let segmentCount = Math.floor(lengthFactor);
  if (segmentCount < minSegments) segmentCount = minSegments;
  if (segmentCount > maxSegments) segmentCount = maxSegments;

  const bendTs: number[] = [];
  for (let i = 1; i <= segmentCount; i += 1) {
    bendTs.push(i / (segmentCount + 1));
  }

  const bends = bendTs.map((t) => {
    // Smooth easing: 0 at endpoints, 1 at center.
    const ease = Math.sin(Math.PI * t);
    const localOffset = offset * ease;
    return {
      x: src.x + vx * t + nx * localOffset,
      y: src.y + vy * t + ny * localOffset,
    };
  });

  const bent = [src, ...bends, tgt];

  // Second stage: if the edge still runs inside buffers for most of its length,
  // nudge the bend points further away from the node rectangles themselves.
  const samplePerSegment = 4;
  let totalSamples = 0;
  let insideBuffer = 0;

  const rectContains = (px: number, py: number, rect: BufferRect, pad = 0) =>
    px >= rect.left - pad
    && px <= rect.right + pad
    && py >= rect.top - pad
    && py <= rect.bottom + pad;

  for (let i = 0; i < bent.length - 1; i += 1) {
    const a = bent[i];
    const b = bent[i + 1];
    for (let j = 1; j <= samplePerSegment; j += 1) {
      const t = j / (samplePerSegment + 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      totalSamples += 1;
      if (buffers.some(rect => rectContains(px, py, rect, 0))) {
        insideBuffer += 1;
      }
    }
  }

  const coverage = totalSamples > 0 ? insideBuffer / totalSamples : 0;
  // If a significant fraction of the bent edge still runs through buffers,
  // push it further away from node centers.
  if (coverage <= 0.4) {
    return bent;
  }

  // Compute a gentle repulsion direction from node centers for samples that are
  // too close to the nodes (inner 40px around the node centers).
  let repulseX = 0;
  let repulseY = 0;

  for (let i = 0; i < bent.length - 1; i += 1) {
    const a = bent[i];
    const b = bent[i + 1];
    for (let j = 1; j <= samplePerSegment; j += 1) {
      const t = j / (samplePerSegment + 1);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;

      buffers.forEach((rect) => {
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const innerHalfW = Math.max((rect.right - rect.left) / 2 - 40, 0);
        const innerHalfH = Math.max((rect.bottom - rect.top) / 2 - 40, 0);
        const inInner =
          Math.abs(px - cx) <= innerHalfW
          && Math.abs(py - cy) <= innerHalfH;
        if (inInner) {
          repulseX += px - cx;
          repulseY += py - cy;
        }
      });
    }
  }

  const repulseLen = Math.hypot(repulseX, repulseY);
  if (repulseLen < 1e-3) {
    return bent;
  }

  const rx = repulseX / repulseLen;
  const ry = repulseY / repulseLen;
  const extraOffset = BUFFER_REPULSION_RADIUS * 1.6;

  const adjusted = bent.map((p, idx) => {
    if (idx === 0 || idx === bent.length - 1) {
      return { ...p };
    }
    return {
      x: p.x + rx * extraOffset,
      y: p.y + ry * extraOffset,
    };
  });

  return adjusted;
}

// ========== WRAPPER FUNCTIONS ==========

/**
 * Builds buffer rectangles from ReactFlow nodes.
 * Wraps logic from GraphLayouter.tsx lines 236-268.
 */
export function buildBufferRectsFromNodes(
  nodes: Array<{ id: string; position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean }>,
  margin: number,
  excludeIds?: Set<string>,
): BufferRect[] {
  const DEFAULT_NODE_WIDTH = 180;
  const DEFAULT_NODE_HEIGHT = 72;

  return nodes
    .filter(n =>
      !n.hidden &&
      n.position &&
      Number.isFinite(n.position.x) &&
      Number.isFinite(n.position.y) &&
      !excludeIds?.has(n.id)
    )
    .map(node => {
      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;
      const left = (node.position!.x ?? 0) - margin;
      const top = (node.position!.y ?? 0) - margin;

      return {
        id: node.id,
        left,
        right: left + width + margin * 2,
        top,
        bottom: top + height + margin * 2,
      };
    });
}

/**
 * Converts waypoint polyline to smooth Bezier curve.
 * Extracts logic from GraphLayouter.tsx lines 2249-2264.
 */
export function convertPolylineToBezier(
  waypoints: Point[],
): { polyline: Point[]; isCurved: boolean } {
  // If only 2 points (straight edge), return as-is
  if (waypoints.length <= 2) {
    return {
      polyline: waypoints,
      isCurved: false,
    };
  }

  // Extract control points from waypoints
  const a = waypoints[0];                        // Start
  const d = waypoints[waypoints.length - 1];     // End
  const innerStart = waypoints[1];               // First waypoint
  const innerEnd = waypoints[waypoints.length - 2]; // Last waypoint

  const scale = LONGEST_TRACE_BEZIER_HANDLE_SCALE; // 1.35

  // Extrapolate Bezier control points by 1.35x
  const b = {
    x: a.x + (innerStart.x - a.x) * scale,
    y: a.y + (innerStart.y - a.y) * scale,
  };
  const c = {
    x: d.x + (innerEnd.x - d.x) * scale,
    y: d.y + (innerEnd.y - d.y) * scale,
  };

  // Sample cubic Bezier at 32 points (creates 33-point array)
  const polyline = sampleCubicBezier(a, b, c, d, LONGEST_TRACE_BEZIER_SAMPLES);

  return {
    polyline,
    isCurved: true,
  };
}

/**
 * MAIN API: Generate dynamic edge curve based on current node positions.
 * This is the primary function called by OcdfgEdge.tsx for real-time routing.
 */
export function generateDynamicEdgeCurve(
  sourceCenter: Point,
  targetCenter: Point,
  allNodes: Array<{ id: string; position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean }>,
  sourceId: string,
  targetId: string,
): { polyline: Point[]; isCurved: boolean } {
  // 1. Build buffer zones from current node positions
  const buffers = buildBufferRectsFromNodes(
    allNodes,
    BUFFER_ZONE_MARGIN,
    new Set([sourceId, targetId]), // Exclude source and target
  );

  // 2. Detect collisions and generate waypoints
  const waypoints = relaxPolylineAroundBuffers(
    [sourceCenter, targetCenter],
    buffers,
    sourceId,
    targetId,
  );

  // 3. Convert waypoints to smooth Bezier curve
  return convertPolylineToBezier(waypoints);
}
