/**
 * Edge Curve Generation Utilities
 *
 * Extracted from GraphLayouter.tsx to enable reuse in real-time dynamic edge routing.
 * Contains sophisticated collision detection and smooth Bezier curve generation logic.
 */

import { sampleCubicBezier, type Point } from './edgeGeometry';

// ========== CONSTANTS ==========
// CRITICAL: Must match GraphLayouter.tsx values exactly for algorithmic parity!
// The previous mismatch (15px vs 33.75px) caused dynamic routing to produce different curves.
export const BUFFER_ZONE_MARGIN = 45 * 0.75; // 33.75px - matches GraphLayouter
export const BUFFER_REPULSION_RADIUS = BUFFER_ZONE_MARGIN + 30 * 0.75; // 56.25px - matches GraphLayouter
export const LONGEST_TRACE_BEZIER_SAMPLES = 32;
export const LONGEST_TRACE_BEZIER_HANDLE_SCALE = 1.35;
export const LONGEST_TRACE_LANE_OFFSET = 12;
export const CYCLE_BEND_MAGNITUDE = 32; // max(24, 64 * 0.5) for bidirectional edges

// ========== TYPES ==========

export interface BufferRect {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Parametric edge curve representation with independent control points.
 * Enables full cubic bezier flexibility including S-curves.
 */
export interface EdgeCurveParams {
  // Control point 1 (P1, near source)
  curvature1: number;     // 0.0-1.0: offset magnitude for P1 (0=on line, 1=max offset)
  direction1: number;     // -1.0 to 1.0: perpendicular offset direction (left/right)
  position1: number;      // 0.0-1.0: where along edge P1 is positioned (default ~0.33)

  // Control point 2 (P2, near target)
  curvature2: number;     // 0.0-1.0: offset magnitude for P2
  direction2: number;     // -1.0 to 1.0: perpendicular offset direction (left/right)
  position2: number;      // 0.0-1.0: where along edge P2 is positioned (default ~0.67)
}

/**
 * Minimal curve state for dynamic routing and smooth interpolation.
 * Captures all information needed to recreate or interpolate a curve.
 */
export interface EdgeCurveState {
  // Edge type discriminator
  curveType: 'straight' | 'bidirectional' | 'collision';

  // For bidirectional edges
  bendDir?: 1 | -1;

  // For collision-based curves (waypoints before bezier conversion)
  waypoints?: Point[];

  // Original computation endpoints (for detecting movement)
  sourceCenter: Point;
  targetCenter: Point;

  // For parallel edges
  laneOffset?: Point;
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

  // PHASE 0 FIX: Test ALL THREE options (straight, left, right) and choose the BEST.
  // The old approach blindly pushed away from node centers, which could make
  // buffer intersection WORSE. Now we test all options and pick the one with
  // the FEWEST buffer hits - including staying straight if that's best!

  const baseOffset = BUFFER_REPULSION_RADIUS;
  const offset = needsStrongerCurve ? baseOffset * 1.05 : baseOffset * 0.7;

  // Compute segment count for bend generation
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

  // Perpendicular directions (right and left)
  const perpX = -vy / segLen;
  const perpY = vx / segLen;

  // Test curving in a given direction and count buffer hits
  const testCurve = (dirX: number, dirY: number, curveOffset: number): number => {
    let hits = 0;
    for (const t of bendTs) {
      const ease = Math.sin(Math.PI * t);
      const localOffset = curveOffset * ease;
      const px = src.x + vx * t + dirX * localOffset;
      const py = src.y + vy * t + dirY * localOffset;

      // Check if this point falls inside any buffer (NO padding for accurate test)
      if (allowedBuffers.some(rect => isInside(px, py, rect, 0))) {
        hits += 1;
      }
    }
    return hits;
  };

  // Test ALL THREE options: straight (offset=0), right curve, left curve
  const hitsStraight = testCurve(perpX, perpY, 0);  // Straight line (no curve)
  const hitsRight = testCurve(perpX, perpY, offset);
  const hitsLeft = testCurve(-perpX, -perpY, offset);

  // Choose the option with the FEWEST buffer hits
  const minHits = Math.min(hitsStraight, hitsRight, hitsLeft);

  // CRITICAL: If staying straight is best (or tied for best), stay straight!
  if (hitsStraight === minHits) {
    // Straight line is best - don't curve at all
    return polyline.map(p => ({ ...p }));
  }

  // Otherwise, curve in the better direction
  let nx: number;
  let ny: number;

  if (hitsRight < hitsLeft) {
    // Right direction is better than left
    nx = perpX;
    ny = perpY;
  } else if (hitsLeft < hitsRight) {
    // Left direction is better than right
    nx = -perpX;
    ny = -perpY;
  } else {
    // Both curve directions have equal hits (but worse than straight, which we already handled)
    // Use center-based logic as tie-breaker
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

    // If blockers are symmetric, fall back to stable perpendicular
    if (Math.hypot(dirX, dirY) < 1e-3) {
      dirX = -vy;
      dirY = vx;
    }

    const dirLen = Math.hypot(dirX, dirY) || 1;
    nx = dirX / dirLen;
    ny = dirY / dirLen;
  }

  // Generate final bends using the chosen direction (nx, ny)
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
  // IMPORTANT: With three-way testing already choosing optimal direction,
  // second-stage refinement should be RARE. Only apply in extreme cases
  // where edge deeply penetrates buffers (>90% coverage).
  // Lower thresholds cause artifacts from center-based repulsion conflicting
  // with the chosen curve direction.
  if (coverage <= 0.90) {
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
  const extraOffset = BUFFER_REPULSION_RADIUS * 1.0;

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

// ========== PARAMETRIC EDGE SYSTEM ==========

/**
 * Computes parametric curve representation from collision detection waypoints.
 * Extracts independent control point parameters enabling S-curves and full bezier flexibility.
 *
 * @param waypoints - Output from relaxPolylineAroundBuffers (2+ points)
 * @param sourceCenter - Source node center point
 * @param targetCenter - Target node center point
 * @returns EdgeCurveParams with 6 parameters for independent control points
 */
export function computeCurveParameters(
  waypoints: Point[],
  sourceCenter: Point,
  targetCenter: Point,
): EdgeCurveParams {
  // Straight edge (no collision detected)
  if (waypoints.length === 2) {
    return {
      curvature1: 0,
      direction1: 0,
      position1: 0.33,
      curvature2: 0,
      direction2: 0,
      position2: 0.67,
    };
  }

  // Edge properties
  const vx = targetCenter.x - sourceCenter.x;
  const vy = targetCenter.y - sourceCenter.y;
  const edgeLength = Math.hypot(vx, vy);

  // Handle degenerate case
  if (!Number.isFinite(edgeLength) || edgeLength < 1e-3) {
    return {
      curvature1: 0,
      direction1: 0,
      position1: 0.33,
      curvature2: 0,
      direction2: 0,
      position2: 0.67,
    };
  }

  // Perpendicular unit vector (normalized)
  const perpX = -vy / edgeLength;
  const perpY = vx / edgeLength;

  // Extract P1 from first inner waypoint
  const waypoint1 = waypoints[1];
  // PROJECT waypoint onto edge vector to get true position along line
  // (not euclidean distance which is longer due to perpendicular offset)
  const t1 = ((waypoint1.x - sourceCenter.x) * vx + (waypoint1.y - sourceCenter.y) * vy) / (edgeLength * edgeLength);

  // Expected position if waypoint1 was on straight line
  const expectedPos1 = {
    x: sourceCenter.x + vx * t1,
    y: sourceCenter.y + vy * t1,
  };

  // Actual offset from straight line
  const offset1X = waypoint1.x - expectedPos1.x;
  const offset1Y = waypoint1.y - expectedPos1.y;
  const offset1Mag = Math.hypot(offset1X, offset1Y);

  // Project onto perpendicular to get signed direction (-1 to 1)
  const dir1 = offset1Mag > 1e-6
    ? (offset1X * perpX + offset1Y * perpY) / offset1Mag
    : 0;

  // Normalize curvature by base offset (75px)
  const curvature1 = Math.min(1.0, offset1Mag / BUFFER_REPULSION_RADIUS);

  // Extract P2 from last inner waypoint
  const waypoint2 = waypoints[waypoints.length - 2];
  // PROJECT waypoint onto edge vector to get true position along line
  const t2 = ((waypoint2.x - sourceCenter.x) * vx + (waypoint2.y - sourceCenter.y) * vy) / (edgeLength * edgeLength);

  const expectedPos2 = {
    x: sourceCenter.x + vx * t2,
    y: sourceCenter.y + vy * t2,
  };

  const offset2X = waypoint2.x - expectedPos2.x;
  const offset2Y = waypoint2.y - expectedPos2.y;
  const offset2Mag = Math.hypot(offset2X, offset2Y);

  const dir2 = offset2Mag > 1e-6
    ? (offset2X * perpX + offset2Y * perpY) / offset2Mag
    : 0;

  const curvature2 = Math.min(1.0, offset2Mag / BUFFER_REPULSION_RADIUS);

  // Clamp positions to reasonable ranges
  const position1 = Math.max(0.1, Math.min(0.5, t1));
  const position2 = Math.max(0.5, Math.min(0.9, t2));

  return {
    curvature1,
    direction1: dir1,
    position1,
    curvature2,
    direction2: dir2,
    position2,
  };
}

/**
 * Generates cubic bezier control points from parametric curve representation.
 * Enables real-time curve generation with full bezier flexibility including S-curves.
 *
 * @param source - Source point (P0)
 * @param target - Target point (P3)
 * @param params - EdgeCurveParams with 6 parameters
 * @returns Cubic bezier control points {p0, p1, p2, p3}
 */
export function generateBezierFromParams(
  source: Point,
  target: Point,
  params: EdgeCurveParams,
): { p0: Point; p1: Point; p2: Point; p3: Point } {
  const p0 = source;
  const p3 = target;

  // Edge vector and properties
  const vx = target.x - source.x;
  const vy = target.y - source.y;
  const edgeLength = Math.hypot(vx, vy);

  // Handle degenerate case (zero-length edge)
  if (!Number.isFinite(edgeLength) || edgeLength < 1e-3) {
    return {
      p0: { ...source },
      p1: { ...source },
      p2: { ...target },
      p3: { ...target },
    };
  }

  // Perpendicular unit vector (normalized)
  const perpX = -vy / edgeLength;
  const perpY = vx / edgeLength;

  // CRITICAL FIX: Use the SAME base offset that was used to normalize curvature
  // in computeCurveParameters. The logarithmic scaling was causing artifacts
  // by amplifying the offset beyond what was in the original waypoints.
  const baseOffset = BUFFER_REPULSION_RADIUS;

  // P1: First control point (near source)
  const offset1 = baseOffset * params.curvature1 * params.direction1;
  const p1 = {
    x: source.x + vx * params.position1 + perpX * offset1,
    y: source.y + vy * params.position1 + perpY * offset1,
  };

  // P2: Second control point (near target)
  const offset2 = baseOffset * params.curvature2 * params.direction2;
  const p2 = {
    x: source.x + vx * params.position2 + perpX * offset2,
    y: source.y + vy * params.position2 + perpY * offset2,
  };

  return { p0, p1, p2, p3 };
}

// ========== CURVE REGENERATION FOR DYNAMIC ROUTING ==========

/**
 * Regenerates a bidirectional (cycle) curve with the same algorithm as GraphLayouter.
 * Uses control points at t=0.33 and t=0.66 with perpendicular offset.
 */
export function regenerateBidirectionalCurve(
  src: Point,
  tgt: Point,
  bendDir: 1 | -1,
  bendMagnitude: number = CYCLE_BEND_MAGNITUDE,
): { polyline: Point[]; isCurved: boolean } {
  const vx = tgt.x - src.x;
  const vy = tgt.y - src.y;
  const vLen = Math.hypot(vx, vy) || 1;

  // Perpendicular normal (rotated 90°)
  const nx = -vy / vLen;
  const ny = vx / vLen;

  // Control points at 1/3 and 2/3 along the edge (matches GraphLayouter buildCyclePolyline)
  const ctrl1 = {
    x: src.x + vx * 0.33 + nx * bendDir * bendMagnitude,
    y: src.y + vy * 0.33 + ny * bendDir * bendMagnitude,
  };
  const ctrl2 = {
    x: src.x + vx * 0.66 + nx * bendDir * bendMagnitude,
    y: src.y + vy * 0.66 + ny * bendDir * bendMagnitude,
  };

  const polyline = sampleCubicBezier(src, ctrl1, ctrl2, tgt, LONGEST_TRACE_BEZIER_SAMPLES);
  return { polyline, isCurved: true };
}

/**
 * Regenerates a collision-avoiding curve using relaxPolylineAroundBuffers.
 * Uses the exact same algorithm as GraphLayouter for parity.
 */
export function regenerateCollisionCurve(
  src: Point,
  tgt: Point,
  buffers: BufferRect[],
  sourceId: string,
  targetId: string,
): { polyline: Point[]; isCurved: boolean } {
  const relaxed = relaxPolylineAroundBuffers([src, tgt], buffers, sourceId, targetId);

  if (relaxed.length > 2) {
    // Convert to bezier with handle scaling (matches GraphLayouter)
    const a = relaxed[0];
    const d = relaxed[relaxed.length - 1];
    const innerStart = relaxed[1];
    const innerEnd = relaxed[relaxed.length - 2];
    const scale = LONGEST_TRACE_BEZIER_HANDLE_SCALE;

    const b = {
      x: a.x + (innerStart.x - a.x) * scale,
      y: a.y + (innerStart.y - a.y) * scale,
    };
    const c = {
      x: d.x + (innerEnd.x - d.x) * scale,
      y: d.y + (innerEnd.y - d.y) * scale,
    };

    return {
      polyline: sampleCubicBezier(a, b, c, d, LONGEST_TRACE_BEZIER_SAMPLES),
      isCurved: true,
    };
  }

  return { polyline: relaxed, isCurved: false };
}

/**
 * Main API: Regenerates a curve from its parametric state with new endpoints.
 * Uses the EXACT same algorithm as GraphLayouter for guaranteed parity.
 */
export function regenerateCurveFromState(
  state: EdgeCurveState,
  newSourceCenter: Point,
  newTargetCenter: Point,
  buffers: BufferRect[],
  sourceId: string,
  targetId: string,
): { polyline: Point[]; isCurved: boolean; newState: EdgeCurveState } {
  let result: { polyline: Point[]; isCurved: boolean };

  switch (state.curveType) {
    case 'straight':
      result = { polyline: [newSourceCenter, newTargetCenter], isCurved: false };
      break;

    case 'bidirectional':
      result = regenerateBidirectionalCurve(
        newSourceCenter,
        newTargetCenter,
        state.bendDir ?? 1,
        CYCLE_BEND_MAGNITUDE,
      );
      break;

    case 'collision':
      result = regenerateCollisionCurve(
        newSourceCenter,
        newTargetCenter,
        buffers,
        sourceId,
        targetId,
      );
      break;

    default:
      result = { polyline: [newSourceCenter, newTargetCenter], isCurved: false };
  }

  // Apply lane offset if present
  if (state.laneOffset && (state.laneOffset.x !== 0 || state.laneOffset.y !== 0)) {
    result.polyline = result.polyline.map(p => ({
      x: p.x + state.laneOffset!.x,
      y: p.y + state.laneOffset!.y,
    }));
  }

  // Return updated state with new endpoints
  const newState: EdgeCurveState = {
    ...state,
    sourceCenter: newSourceCenter,
    targetCenter: newTargetCenter,
  };

  return { ...result, newState };
}

/**
 * Interpolates a polyline to follow new endpoints during node dragging.
 * Uses scale + rotate transformation to preserve curve shape.
 */
export function interpolatePolyline(
  points: Point[],
  oldSrc: Point,
  oldTgt: Point,
  newSrc: Point,
  newTgt: Point,
): Point[] {
  if (points.length < 2) return points;

  const oldVec = { x: oldTgt.x - oldSrc.x, y: oldTgt.y - oldSrc.y };
  const newVec = { x: newTgt.x - newSrc.x, y: newTgt.y - newSrc.y };

  const oldLen = Math.hypot(oldVec.x, oldVec.y) || 1;
  const newLen = Math.hypot(newVec.x, newVec.y) || 1;

  // Scale factor
  const scale = newLen / oldLen;

  // Rotation angle
  const oldAngle = Math.atan2(oldVec.y, oldVec.x);
  const newAngle = Math.atan2(newVec.y, newVec.x);
  const rotation = newAngle - oldAngle;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return points.map((p, i) => {
    // Keep endpoints pinned
    if (i === 0) return { ...newSrc };
    if (i === points.length - 1) return { ...newTgt };

    // Transform relative to old source
    const rel = { x: p.x - oldSrc.x, y: p.y - oldSrc.y };

    // Scale
    rel.x *= scale;
    rel.y *= scale;

    // Rotate
    const rotated = {
      x: rel.x * cos - rel.y * sin,
      y: rel.x * sin + rel.y * cos,
    };

    // Translate to new source
    return {
      x: newSrc.x + rotated.x,
      y: newSrc.y + rotated.y,
    };
  });
}
