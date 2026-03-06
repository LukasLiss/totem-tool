import { memo, useMemo } from 'react';
import { BaseEdge, useReactFlow } from '@xyflow/react';
import type { EdgeProps, Node } from '@xyflow/react';
import {
  pointAlongPolylineFromEnd,
  smoothPolyline,
  roundedPath,
  trimPolyline,
  type Point,
  sampleCubicBezier,
} from '../utils/edgeGeometry';

type NodeVariant = 'start' | 'end' | 'center';

type EdgeData = {
  polyline?: Point[];
  owners?: string[];
  ownerTypes?: string[];
  colors?: Record<string, string>;
  parallelIndex?: number;
  parallelCount?: number;
  sourceVariant?: NodeVariant;
  targetVariant?: NodeVariant;
  edgeKind?: 'normal' | 'selfLoop';
  frequency?: number;
  thicknessFactor?: number;
  frequencyNormalized?: number;
  sourceAnchorOffset?: { x: number; y: number };
  targetAnchorOffset?: { x: number; y: number };
  overlayDebug?: boolean;
  polylineKind?: 'polyline' | 'bezier';
  dimmed?: boolean;
};

const DEFAULT_COLOR = '#2563EB';
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;
const EPSILON = 1e-6;
const POINT_TOLERANCE = 0.5;

function buildFallbackPolyline(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): Point[] {
  const midX = (sourceX + targetX) / 2;
  return [
    { x: sourceX, y: sourceY },
    { x: midX, y: sourceY },
    { x: midX, y: targetY },
    { x: targetX, y: targetY },
  ];
}

function clampPolylineToEndpoints(points: Point[], source: Point, target: Point): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...source }];
  const result = points.map(point => ({ ...point }));
  if (pointsAreClose(result[0], source)) {
    result[0] = { ...source };
  }
  if (pointsAreClose(result[result.length - 1], target)) {
    result[result.length - 1] = { ...target };
  }
  return result;
}

function pointsAreClose(a?: Point, b?: Point, tolerance = POINT_TOLERANCE) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function pointOnNodeBoundary(
  point: Point | undefined,
  geometry: { center: Point; size: { width: number; height: number } },
  tolerance = POINT_TOLERANCE,
) {
  if (!point) {
    return false;
  }
  const halfWidth = geometry.size.width / 2;
  const halfHeight = geometry.size.height / 2;
  const dx = Math.abs(point.x - geometry.center.x);
  const dy = Math.abs(point.y - geometry.center.y);
  const onVertical = Math.abs(dx - halfWidth) <= tolerance && dy <= halfHeight + tolerance;
  const onHorizontal = Math.abs(dy - halfHeight) <= tolerance && dx <= halfWidth + tolerance;
  return onVertical || onHorizontal;
}

function isOutsideRect(
  point: Point | undefined,
  geometry: { center: Point; size: { width: number; height: number } },
  tolerance = 0,
) {
  if (!point) return false;
  const halfWidth = geometry.size.width / 2 + tolerance;
  const halfHeight = geometry.size.height / 2 + tolerance;
  const dx = Math.abs(point.x - geometry.center.x);
  const dy = Math.abs(point.y - geometry.center.y);
  return dx > halfWidth || dy > halfHeight;
}

function intersectSegmentWithRect(
  outside: Point,
  inside: Point,
  geometry: { center: Point; size: { width: number; height: number } },
): Point | null {
  const halfWidth = geometry.size.width / 2;
  const halfHeight = geometry.size.height / 2;
  const left = geometry.center.x - halfWidth;
  const right = geometry.center.x + halfWidth;
  const top = geometry.center.y - halfHeight;
  const bottom = geometry.center.y + halfHeight;

  const dx = inside.x - outside.x;
  const dy = inside.y - outside.y;
  const EPS = 1e-9;

  let tEnter = 0;
  let tLeave = 1;

  const clip = (p: number, q: number) => {
    if (Math.abs(p) < EPS) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tLeave) return false;
      if (r > tEnter) tEnter = r;
    } else {
      if (r < tEnter) return false;
      if (r < tLeave) tLeave = r;
    }
    return true;
  };

  if (
    !clip(-dx, outside.x - left)
    || !clip(dx, right - outside.x)
    || !clip(-dy, outside.y - top)
    || !clip(dy, bottom - outside.y)
  ) {
    return null;
  }

  return {
    x: outside.x + dx * tEnter,
    y: outside.y + dy * tEnter,
  };
}

function clipTailToRect(
  points: Point[],
  geometry: { center: Point; size: { width: number; height: number } },
): Point[] {
  if (points.length < 2) return points;

  let crossingIndex = -1;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const currentlyOutside = isOutsideRect(points[i], geometry);
    const nextInsideOrOnEdge = !isOutsideRect(points[i + 1], geometry);
    if (currentlyOutside && nextInsideOrOnEdge) {
      crossingIndex = i;
      break;
    }
  }

  if (crossingIndex === -1) {
    return points;
  }

  const entry = intersectSegmentWithRect(
    points[crossingIndex],
    points[crossingIndex + 1],
    geometry,
  );

  if (!entry) {
    return points;
  }

  const trimmed = points.slice(0, crossingIndex + 1);
  trimmed.push(entry);
  return trimmed;
}

function calculateCollisionPoint(tail: Point, head: Point, headWidth: number, headHeight: number): Point {
  const epsilon = 1e-5;
  const deltaX = tail.x - head.x;
  const deltaY = tail.y - head.y;

  const halfWidth = Math.max(headWidth / 2, epsilon);
  const halfHeight = Math.max(headHeight / 2, epsilon);

  if (Math.abs(deltaX) < epsilon) {
    return {
      x: head.x,
      y: head.y + (deltaY > 0 ? halfHeight : -halfHeight),
    };
  }

  if (Math.abs(deltaY) < epsilon) {
    return {
      x: head.x + (deltaX > 0 ? halfWidth : -halfWidth),
      y: head.y,
    };
  }

  const tHorizontal = Math.abs(halfHeight / deltaY);
  const tVertical = Math.abs(halfWidth / deltaX);
  const t = Math.min(tHorizontal, tVertical);

  return {
    x: head.x + t * deltaX,
    y: head.y + t * deltaY,
  };
}

type ArrowGeometry = {
  path: string;
  length: number;
};

function buildArrowHead(tip: Point, prev: Point, scale: number): ArrowGeometry | null {
  const dx = tip.x - prev.x;
  const dy = tip.y - prev.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < EPSILON) {
    return null;
  }

  const ux = dx / length;
  const uy = dy / length;

  const desiredLength = 16 * scale;
  const arrowLength = Math.min(desiredLength, length);
  const arrowWidth = Math.min(10 * scale, Math.max(arrowLength * 0.6, 4 * scale));
  const halfWidth = arrowWidth / 2;

  const baseCenter = {
    x: tip.x - ux * arrowLength,
    y: tip.y - uy * arrowLength,
  };
  const perpX = -uy;
  const perpY = ux;

  const left = {
    x: baseCenter.x + perpX * halfWidth,
    y: baseCenter.y + perpY * halfWidth,
  };
  const right = {
    x: baseCenter.x - perpX * halfWidth,
    y: baseCenter.y - perpY * halfWidth,
  };

  return {
    path: `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`,
    length: arrowLength,
  };
}

function resolveNodeGeometry(node: Node | undefined) {
  if (!node) return null;
  const width = node.width ?? DEFAULT_NODE_WIDTH;
  const height = node.height ?? DEFAULT_NODE_HEIGHT;
  const position = node.positionAbsolute ?? node.position;
  const x = position?.x ?? 0;
  const y = position?.y ?? 0;
  return {
    center: {
      x: x + width / 2,
      y: y + height / 2,
    },
    size: { width, height },
  };
}

// TODO: schoener ineinander verschachteln bei mehreren self-loops machen
function buildSelfLoopPolyline(
  geometry: { center: Point; size: { width: number; height: number } },
  laneIndex: number = 0,
  laneCount: number = 1,
): Point[] {
  const { center, size } = geometry;
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  const sideOffset = Math.max(Math.min(halfHeight * 0.4, halfHeight - 14), Math.min(halfHeight, 6));
  const entryOffset = Math.max(Math.min(halfWidth * 0.3, halfWidth - 18), halfWidth * 0.2);

  const exitPoint = { x: center.x + halfWidth, y: center.y - sideOffset };
  const entryPoint = { x: center.x + entryOffset, y: center.y - halfHeight };
  const outwardTarget = {
    x: center.x + halfWidth + Math.max(size.width, 60) * 0.85,
    y: center.y - halfHeight - Math.max(size.height, 40) * 1.35,
  };
  const normalize = (x: number, y: number): Point => {
    const length = Math.hypot(x, y);
    if (length < EPSILON) {
      return { x: 0.8, y: -0.6 };
    }
    return { x: x / length, y: y / length };
  };

  const preferredOutward = normalize(outwardTarget.x - center.x, outwardTarget.y - center.y);
  let outwardDir = { ...preferredOutward };
  const diff = { x: exitPoint.x - entryPoint.x, y: exitPoint.y - entryPoint.y };
  const chordLength = Math.hypot(diff.x, diff.y);
  const desiredRadius = Math.max(size.height * 0.5, chordLength / 2 + 4);
  const minRadius = Math.max(chordLength / 2 + 2, size.height * 0.45, 18);
  const minAlpha = Math.max(Math.min(halfWidth, halfHeight) * 0.25, 12);

  const solveCircle = (direction: Point) => {
    const dot = diff.x * direction.x + diff.y * direction.y;
    if (Math.abs(dot) < EPSILON) {
      return null;
    }
    const exitSqr = exitPoint.x * exitPoint.x + exitPoint.y * exitPoint.y;
    const entrySqr = entryPoint.x * entryPoint.x + entryPoint.y * entryPoint.y;
    const centerDot = diff.x * center.x + diff.y * center.y;
    const alpha = (exitSqr - entrySqr - 2 * centerDot) / (2 * dot);
    if (!Number.isFinite(alpha) || alpha < minAlpha) {
      return null;
    }
    const circleCenter = {
      x: center.x + direction.x * alpha,
      y: center.y + direction.y * alpha,
    };
    const radius = Math.hypot(exitPoint.x - circleCenter.x, exitPoint.y - circleCenter.y);
    if (!Number.isFinite(radius) || radius < minRadius) {
      return null;
    }
    return { center: circleCenter, radius, direction };
  };

  const fallbackCircle = (targetRadius = desiredRadius) => {
    if (chordLength < EPSILON) {
      return null;
    }
    let perp = { x: entryPoint.y - exitPoint.y, y: exitPoint.x - entryPoint.x };
    let perpLength = Math.hypot(perp.x, perp.y);
    if (perpLength < EPSILON) {
      perp = { x: -diff.y, y: diff.x };
      perpLength = Math.hypot(perp.x, perp.y);
    }
    perp = { x: perp.x / perpLength, y: perp.y / perpLength };
    if (perp.x * preferredOutward.x + perp.y * preferredOutward.y < 0) {
      perp = { x: -perp.x, y: -perp.y };
    }
    const midpoint = {
      x: (exitPoint.x + entryPoint.x) / 2,
      y: (exitPoint.y + entryPoint.y) / 2,
    };
    const radiusGoal = Math.max(targetRadius, minRadius);
    const offset = Math.sqrt(Math.max(radiusGoal * radiusGoal - (chordLength / 2) * (chordLength / 2), 0));
    const circleCenter = {
      x: midpoint.x + perp.x * offset,
      y: midpoint.y + perp.y * offset,
    };
    const radius = Math.hypot(exitPoint.x - circleCenter.x, exitPoint.y - circleCenter.y);
    if (!Number.isFinite(radius)) {
      return null;
    }
    return { center: circleCenter, radius, direction: perp };
  };

  let circle = solveCircle(outwardDir);
  if (!circle) {
    outwardDir = { x: -outwardDir.x, y: -outwardDir.y };
    circle = solveCircle(outwardDir);
  }
  if (circle && circle.radius > desiredRadius * 1.35) {
    const tightened = fallbackCircle(desiredRadius);
    if (tightened) {
      circle = tightened;
    }
  }
  if (!circle) {
    circle = fallbackCircle();
  }
  if (!circle) {
    return [exitPoint, entryPoint];
  }

  const { center: circleCenter, radius, direction } = circle;
  const thetaStart = Math.atan2(exitPoint.y - circleCenter.y, exitPoint.x - circleCenter.x);
  const thetaEnd = Math.atan2(entryPoint.y - circleCenter.y, entryPoint.x - circleCenter.x);

  const twoPi = Math.PI * 2;
  let deltaCW = thetaEnd - thetaStart;
  if (deltaCW > 0) {
    deltaCW -= twoPi;
  }
  const deltaCCW = deltaCW + twoPi;
  const thetaOut = Math.atan2(direction.y, direction.x);
  const angleDiff = (a: number, b: number) => {
    let d = a - b;
    while (d > Math.PI) d -= twoPi;
    while (d < -Math.PI) d += twoPi;
    return Math.abs(d);
  };
  const midCW = thetaStart + deltaCW / 2;
  const midCCW = thetaStart + deltaCCW / 2;
  const delta = angleDiff(midCCW, thetaOut) < angleDiff(midCW, thetaOut) ? deltaCCW : deltaCW;

  const segments = 12;
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = thetaStart + delta * t;
    const x = circleCenter.x + radius * Math.cos(angle);
    const y = circleCenter.y + radius * Math.sin(angle);
    if (i === 0) {
      points.push({ ...exitPoint });
    } else if (i === segments) {
      points.push({ ...entryPoint });
    } else {
      points.push({ x, y });
    }
  }
  // If multiple self-loops exist, scale the entire curve toward the center to keep concentric rings.
  if (laneCount > 1 && laneIndex > 0) {
    const scale = Math.max(0.5, 1 - laneIndex * 0.2);
    return points.map(p => ({
      x: center.x + (p.x - center.x) * scale,
      y: center.y + (p.y - center.y) * scale,
    }));
  }

  return points;
}

const OcdfgEdge = memo(function OcdfgEdge({
  id,
  data,
  selected,
  animated,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  target,
  style,
}: EdgeProps<EdgeData>) {
  const owners = data?.owners && data.owners.length > 0 ? data.owners : ['default'];
  const colorMap = data?.colors ?? {};
  const reactFlow = useReactFlow();
  const sourceGeometry = resolveNodeGeometry(reactFlow.getNode(source));
  const targetGeometry = resolveNodeGeometry(reactFlow.getNode(target));
  const isSelfLoop = data?.edgeKind === 'selfLoop';
  const overlayDebug = data?.overlayDebug === true;
  const dimmed = data?.dimmed === true;
  const sourceOffset = data?.sourceAnchorOffset ?? { x: 0, y: 0 };
  const targetOffset = data?.targetAnchorOffset ?? { x: 0, y: 0 };

  const polyline = useMemo(() => {
    if (isSelfLoop && targetGeometry) {
      const laneIdx = (data?.parallelIndex ?? 0);
      const laneCount = (data?.parallelCount ?? 1);
      return buildSelfLoopPolyline(targetGeometry, laneIdx, laneCount);
    }

    // Compute base polyline points
    let basePoints: Point[];

    // DISABLED: Parametric edge rendering was causing massive backwards bending artifacts
    // because it recomputed curves differently than GraphLayouter. Using pre-computed polyline instead.
    // if (data?.curveParams) {
    //   ... dynamic collision detection code removed ...
    // }

    // Use pre-computed polyline from GraphLayouter (always)
    // Lane offsets for parallel edges are already baked into the polyline by GraphLayouter
    basePoints = (data?.polyline && data.polyline.length >= 2)
      ? data.polyline
      : buildFallbackPolyline(sourceX, sourceY, targetX, targetY);

    // For edges that opt into center anchoring, ensure endpoints track the node
    // positions even when nodes move. Otherwise, clamp the stored polyline to
    // the current handle endpoints.
    const useNodeCenters = data?.sourceAnchorOffset !== undefined;
    const clampedBase = useNodeCenters
      ? basePoints.map((point, index) => {
          if (index === 0) {
            return { x: sourceX + sourceOffset.x, y: sourceY + sourceOffset.y };
          } else if (index === basePoints.length - 1) {
            return { x: targetX + targetOffset.x, y: targetY + targetOffset.y };
          }

          // Proportional stretching: transform intermediate points to follow node movement
          // This makes curved edges stay smooth during node dragging
          const originalSrc = basePoints[0];
          const originalTgt = basePoints[basePoints.length - 1];
          const newSrc = { x: sourceX + sourceOffset.x, y: sourceY + sourceOffset.y };
          const newTgt = { x: targetX + targetOffset.x, y: targetY + targetOffset.y };

          // Calculate original position relative to endpoints (0 to 1 range)
          const originalVector = {
            x: originalTgt.x - originalSrc.x,
            y: originalTgt.y - originalSrc.y,
          };

          // Avoid division by zero for perfectly aligned endpoints
          const relX =
            Math.abs(originalVector.x) > 0.001
              ? (point.x - originalSrc.x) / originalVector.x
              : 0.5;
          const relY =
            Math.abs(originalVector.y) > 0.001
              ? (point.y - originalSrc.y) / originalVector.y
              : 0.5;

          // Apply same relative position to new endpoints
          const newVector = {
            x: newTgt.x - newSrc.x,
            y: newTgt.y - newSrc.y,
          };

          return {
            x: newSrc.x + relX * newVector.x,
            y: newSrc.y + relY * newVector.y,
          };
        })
      : clampPolylineToEndpoints(
          basePoints,
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
        );

    // Adjust both endpoints so the polyline enters and leaves the node on the
    // rectangle boundary, avoiding paths that cut through node interiors. This
    // makes edges look more "side-attached" on strongly horizontal segments.
    let clamped = clampedBase;

    if (sourceGeometry && clamped.length >= 2) {
      const currentSource = clamped[0];
      const nextPoint = clamped[1];
      if (!pointOnNodeBoundary(currentSource, sourceGeometry)) {
        // For lane-offset edges, use the offset center for collision calculation
        const offsetCenter = {
          x: sourceGeometry.center.x + sourceOffset.x,
          y: sourceGeometry.center.y + sourceOffset.y,
        };
        const collisionFromSource = calculateCollisionPoint(
          nextPoint,
          offsetCenter,
          sourceGeometry.size.width,
          sourceGeometry.size.height,
        );
        clamped = clamped.map((point, index) => {
          if (index === 0) {
            return collisionFromSource;
          }
          return { ...point };
        });
      }
    }

    if (!targetGeometry || clamped.length < 2) {
      return clamped;
    }

    const currentTarget = clamped[clamped.length - 1];
    const isBentEdge = data?.polylineKind === 'bezier';
    if (!isBentEdge && pointOnNodeBoundary(currentTarget, targetGeometry)) {
      return clamped;
    }

    const approachPoint = clamped[clamped.length - 2];
    // For lane-offset edges, use the offset center for collision calculation
    const targetOffsetCenter = {
      x: targetGeometry.center.x + targetOffset.x,
      y: targetGeometry.center.y + targetOffset.y,
    };
    const collision = calculateCollisionPoint(
      approachPoint,
      targetOffsetCenter,
      targetGeometry.size.width,
      targetGeometry.size.height,
    );
    const adjusted = clamped.map((point, index) => {
      if (index === clamped.length - 1) {
        return collision;
      }
      return { ...point };
    });
    const clipped = clipTailToRect(adjusted, targetGeometry);
    return clipped;
  }, [
    isSelfLoop,
    data?.polyline,
    data?.polylineKind,
    data?.sourceAnchorOffset,
    sourceGeometry,
    targetGeometry,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceOffset.x,
    sourceOffset.y,
    targetOffset.x,
    targetOffset.y,
  ]);

  const polylineLength = useMemo(() => {
    if (polyline.length < 2) return 0;
    let len = 0;
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const a = polyline[i];
      const b = polyline[i + 1];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return len;
  }, [polyline]);

  const smoothingIterations = useMemo(() => {
    // Skip smoothing for bezier curves (already smooth)
    if (data?.polylineKind === 'bezier') {
      return 0;
    }
    if (polylineLength > 900) return 2;
    if (polylineLength > 450) return 1;
    return 0;
  }, [polylineLength, data?.polylineKind]);

  const smoothedPolyline = useMemo(
    () => (smoothingIterations > 0 ? smoothPolyline(polyline, smoothingIterations) : polyline),
    [polyline, smoothingIterations],
  );

  // Fixed thickness: always 12px (thicknessFactor = 2 for base stroke of 6)
  const thicknessFactorRaw = 2;
  const baseStroke = 6; // Fixed base stroke
  const strokeBase = baseStroke * thicknessFactorRaw; // = 12px
  const tailOwner = owners[0];
  const headOwner = owners[owners.length - 1];
  const tailColor = tailOwner && tailOwner !== 'default'
    ? (colorMap[tailOwner] ?? '#2563EB')
    : '#2563EB';
  const headColor = headOwner && headOwner !== 'default'
    ? (colorMap[headOwner] ?? '#2563EB')
    : '#2563EB';
  const backgroundStrokeWidth = strokeBase + 4 * thicknessFactorRaw;
  const selectionStrokeWidth = strokeBase + 6 * thicknessFactorRaw;
  const minOwnerWidth = 2.5 * thicknessFactorRaw;
  const arrowScale = Math.min(2.2, (strokeBase + 6 * thicknessFactorRaw) / 8);
  const desiredArrowLength = 16 * arrowScale;
  const arrowTip = smoothedPolyline.length > 0
    ? smoothedPolyline[smoothedPolyline.length - 1]
    : null;
  const arrowBase = useMemo(
    () => (desiredArrowLength > 0
      ? pointAlongPolylineFromEnd(smoothedPolyline, desiredArrowLength)
      : null),
    [smoothedPolyline, desiredArrowLength],
  );
  const arrowPrev = arrowBase
    ?? (smoothedPolyline.length > 1
      ? smoothedPolyline[smoothedPolyline.length - 2]
      : arrowTip);
  const arrowGeometry = useMemo(
    () => (arrowTip && arrowPrev ? buildArrowHead(arrowTip, arrowPrev, arrowScale) : null),
    [arrowTip, arrowPrev, arrowScale],
  );
  const trimmedPolyline = useMemo(() => {
    if (!arrowGeometry) {
      return smoothedPolyline;
    }
    return trimPolyline(smoothedPolyline, 0, arrowGeometry.length);
  }, [smoothedPolyline, arrowGeometry]);

  const path = useMemo(() => roundedPath(trimmedPolyline, 30), [trimmedPolyline]);

  const dimOpacity = dimmed ? 0.38 : 1;

  const baseStyle = useMemo(
    () => ({
      ...style,
      stroke: '#CBD5E1',
      strokeWidth: backgroundStrokeWidth,
      strokeOpacity: 0.55 * dimOpacity,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
    }),
    [style, backgroundStrokeWidth, dimOpacity],
  );

  // Detect if source or target node is being dragged to disable CSS transitions
  const isDragging = useMemo(() => {
    const sourceNode = reactFlow.getNode(source);
    const targetNode = reactFlow.getNode(target);
    return (sourceNode?.dragging === true) || (targetNode?.dragging === true);
  }, [reactFlow, source, target, sourceX, sourceY, targetX, targetY]);

  const edgeClassName = useMemo(() => {
    const classes = ['ocdfg-edge'];
    if (animated) classes.push('animated');
    if (isDragging) classes.push('dragging');
    if (dimmed) classes.push('dimmed');
    return classes.join(' ');
  }, [animated, isDragging, dimmed]);

  return (
    <g className={edgeClassName}>
      {overlayDebug && (
        <path
          d={path}
          fill="none"
          stroke="rgba(236, 72, 153, 0.6)" // pink highlighter
          strokeWidth={backgroundStrokeWidth + 14}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none', opacity: 0.6 * dimOpacity }}
        />
      )}

      <BaseEdge
        path={path}
        style={baseStyle}
        className="ocdfg-edge-base"
        interactionWidth={Math.max(selectionStrokeWidth, 36)}
      />

      {owners.map((owner, index) => {
        const color = owner === 'default'
          ? (index === owners.length - 1 ? headColor : tailColor)
          : (colorMap[owner] ?? headColor);
        const width = Math.max(minOwnerWidth, strokeBase / owners.length);
        const dash = owners.length > 1 ? '10 7' : undefined;
        const dashOffset = owners.length > 1 ? index * 6 : undefined;
        return (
          <path
            key={`${id}-${owner}-${index}`}
            d={path}
            fill="none"
            strokeWidth={width}
            strokeDasharray={dash}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ocdfg-edge-stripe"
            style={{ stroke: color, opacity: dimOpacity }}
          />
        );
      })}

      {arrowGeometry?.path && (
        <>
          <path
            className="ocdfg-arrow-head"
            d={arrowGeometry.path}
            fill={headColor}
            opacity={0.95 * dimOpacity}
            style={{ animation: 'none', strokeDasharray: 'none' }}
          />
          <path
            className="ocdfg-arrow-head"
            d={arrowGeometry.path}
            fill="none"
            stroke="#F8FAFC"
            strokeWidth={Math.max(1.2, arrowScale)}
            opacity={0.95 * dimOpacity}
            style={{ animation: 'none', strokeDasharray: 'none' }}
          />
        </>
      )}

      {selected && (
        <path
          d={path}
          fill="none"
          strokeOpacity={0.25}
          strokeWidth={selectionStrokeWidth}
          className="ocdfg-edge-selection"
          style={{ stroke: DEFAULT_COLOR }}
        />
      )}
    </g>
  );
});

export default OcdfgEdge;
