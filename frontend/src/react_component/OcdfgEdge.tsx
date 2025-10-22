import { memo, useMemo } from 'react';
import { BaseEdge, useReactFlow } from '@xyflow/react';
import type { EdgeProps, Node } from '@xyflow/react';
import { roundedPath, trimPolyline, type Point } from '../utils/edgeGeometry';

type NodeVariant = 'start' | 'end' | 'center';

type EdgeData = {
  polyline?: Point[];
  owners?: string[];
  colors?: Record<string, string>;
  parallelIndex?: number;
  parallelCount?: number;
  sourceVariant?: NodeVariant;
  targetVariant?: NodeVariant;
  edgeKind?: 'normal' | 'selfLoop';
  frequency?: number;
  thicknessFactor?: number;
};

const DEFAULT_COLOR = '#2563EB';
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;
const EPSILON = 1e-6;

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
  result[0] = { ...source };
  result[result.length - 1] = { ...target };
  return result;
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
  const maxLength = Math.max(length - EPSILON, 0);
  if (maxLength < EPSILON) {
    return null;
  }
  const arrowLength = Math.min(desiredLength, maxLength);
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

function buildSelfLoopPolyline(geometry: { center: Point; size: { width: number; height: number } }): Point[] {
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
  return points;
}

const OcdfgEdge = memo(function OcdfgEdge({
  id,
  data,
  selected,
  animated,
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
  const targetGeometry = resolveNodeGeometry(reactFlow.getNode(target));
  const isSelfLoop = data?.edgeKind === 'selfLoop';

  const polyline = useMemo(() => {
    if (isSelfLoop && targetGeometry) {
      return buildSelfLoopPolyline(targetGeometry);
    }
    const basePoints = (data?.polyline && data.polyline.length >= 2)
      ? data.polyline
      : buildFallbackPolyline(sourceX, sourceY, targetX, targetY);
    const clamped = clampPolylineToEndpoints(
      basePoints,
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
    );
    if (!targetGeometry || clamped.length < 2) {
      return clamped;
    }
    const approachPoint = clamped[clamped.length - 2];
    const collision = calculateCollisionPoint(
      approachPoint,
      targetGeometry.center,
      targetGeometry.size.width,
      targetGeometry.size.height,
    );
    const adjusted = clamped.map((point, index) => {
      if (index === clamped.length - 1) {
        return collision;
      }
      return { ...point };
    });
    return adjusted;
  }, [isSelfLoop, data?.polyline, targetGeometry, sourceX, sourceY, targetX, targetY]);

  const thicknessFactorRaw = typeof data?.thicknessFactor === 'number' && Number.isFinite(data.thicknessFactor)
    ? Math.min(2, Math.max(0.5, data.thicknessFactor))
    : 1;
  const baseStroke = Math.max(6, owners.length * 3);
  const strokeBase = baseStroke * thicknessFactorRaw;
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
  const arrowTip = polyline.length > 0
    ? polyline[polyline.length - 1]
    : null;
  const arrowPrev = polyline.length > 1
    ? polyline[polyline.length - 2]
    : arrowTip;
  const arrowGeometry = useMemo(
    () => (arrowTip && arrowPrev ? buildArrowHead(arrowTip, arrowPrev, arrowScale) : null),
    [arrowTip, arrowPrev, arrowScale],
  );
  const trimmedPolyline = useMemo(() => {
    if (!arrowGeometry) {
      return polyline;
    }
    const trimAmount = arrowGeometry.length * 0.9;
    return trimPolyline(polyline, 0, trimAmount);
  }, [polyline, arrowGeometry]);

  const path = useMemo(() => roundedPath(trimmedPolyline, 30), [trimmedPolyline]);

  const baseStyle = useMemo(
    () => ({
      ...style,
      stroke: '#CBD5E1',
      strokeWidth: backgroundStrokeWidth,
      strokeOpacity: 0.55,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
    }),
    [style, backgroundStrokeWidth],
  );

  return (
    <g className={`ocdfg-edge${animated ? ' animated' : ''}`}>
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
            style={{ stroke: color }}
          />
        );
      })}

      {arrowGeometry?.path && (
        <>
          <path d={arrowGeometry.path} fill={headColor} opacity={0.95} />
          <path
            d={arrowGeometry.path}
            fill="none"
            stroke="#F8FAFC"
            strokeWidth={Math.max(1.2, arrowScale)}
            opacity={0.95}
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
