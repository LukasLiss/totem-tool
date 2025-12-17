import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { mapTypesToColors, textColorForBackground } from '../utils/objectColors';
import OCDFGDetailVisualizer from './OCDFGDetailVisualizer';
import {
  orderItemOcdfgMock,
  hrWorkerOcdfgMock,
  companyLifecycleOcdfgMock,
  factoryOcdfgMock,
  warehouseOcdfgMock,
  ocdfgDetailMiniMock,
  type OcdfgMockData,
} from '@/mocks/ocdfgDetailMock';

type TotemApiResponse = {
  tempgraph: {
    nodes?: string[];
    [relation: string]: string[] | string[][];
  };
  type_relations?: Array<string[]>;
  all_event_types?: string[];
  object_type_to_event_types?: Record<string, string[]>;
};

type ProcessAreaDefinition = {
  id: string;
  level: number;
  label: string;
  objectTypes: string[];
};

type ProcessLayer = {
  level: number;
  areas: ProcessAreaDefinition[];
};

type TotemVisualizerProps = {
  eventLogId?: number | string | null;
  height?: string | number;
  backendBaseUrl?: string;
};

type RelationType = 'P' | 'D' | 'I' | 'A';

type EdgeDescriptor = {
  id: string;
  relation: RelationType;
  from: string;
  to: string;
  color?: string;
};

type NodePosition = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

type EdgeSegment = {
  id: string;
  relation: RelationType;
  path: string;
  bars?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  capPath?: string;
  arrowPath?: string;
  color?: string;
};

type Point2D = { x: number; y: number };

type LevelNodeDescriptor = {
  id: string;
  areaId: string;
  orderHint: number;
  levelKey: number;
  levelIndex: number;
};

type LayoutInfo = {
  nodeColumns: Record<string, number>;
  areaPlacements: Record<
    string,
    {
      startColumn: number;
      span: number;
    }
  >;
  totalColumns: number;
};

const DEFAULT_BACKEND = 'http://127.0.0.1:8000';
const OBJECT_NODE_WIDTH = 180;
const OBJECT_NODE_MIN_HEIGHT = 80;
const GRID_COLUMN_GAP = 24;
const GRID_ROW_GAP = 20;
const COLUMN_WIDTH = OBJECT_NODE_WIDTH + GRID_COLUMN_GAP;
const PROCESS_AREA_BACKGROUND = 'rgba(59, 130, 246, 0.16)';
const PROCESS_AREA_BORDER = 'rgba(37, 99, 235, 0.35)';
const PROCESS_AREA_INSET_SHADOW = 'inset 0 0 0 1px rgba(37, 99, 235, 0.12)';
const DETAIL_EDGE_STROKE = 'rgba(37, 99, 235, 0.35)';

function resolveHeight(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function normaliseHex(hex: string) {
  if (!hex) return '#1F2937';
  if (hex.startsWith('#')) return hex;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  return '#1F2937';
}

function lighten(hex: string, factor = 0.7) {
  const sanitized = normaliseHex(hex).replace('#', '');
  if (sanitized.length !== 6) return '#E2E8F0';
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  const mix = (channel: number) => clamp(Math.round(channel + (255 - channel) * factor));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function extractEdges(tempgraph?: TotemApiResponse['tempgraph']): EdgeDescriptor[] {
  if (!tempgraph) return [];
  const edges: EdgeDescriptor[] = [];
  let counter = 0;

  const addEdge = (relation: RelationType, from?: string, to?: string) => {
    if (!from || !to) return;
    counter += 1;
    edges.push({
      id: `${relation}-${from}->${to}-${counter}`,
      relation,
      from,
      to,
    });
  };

  const rawDependent = tempgraph['D'];
  if (Array.isArray(rawDependent)) {
    rawDependent.forEach((tuple) => {
      if (Array.isArray(tuple) && tuple.length >= 2) {
        addEdge('D', tuple[0], tuple[1]);
      }
    });
  }

  const rawInitiating = tempgraph['I'];
  if (Array.isArray(rawInitiating)) {
    rawInitiating.forEach((tuple) => {
      if (Array.isArray(tuple) && tuple.length >= 2) {
        addEdge('I', tuple[0], tuple[1]);
      }
    });
  }

  const rawParallel = tempgraph['P'];
  const seenParallel = new Set<string>();
  if (Array.isArray(rawParallel)) {
    rawParallel.forEach((tuple) => {
      if (!Array.isArray(tuple) || tuple.length < 2) return;
      const [from, to] = tuple;
      if (!from || !to) return;
      const key = [from, to].sort((a, b) => a.localeCompare(b)).join('::');
      if (seenParallel.has(key)) return;
      seenParallel.add(key);
      addEdge('P', from, to);
    });
  }

  return edges;
}

function buildParallelBars({
  startX,
  startY,
  endX,
  endY,
  unitX,
  unitY,
  pathLength,
  targetContact: _targetContact,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  pathLength: number;
  targetContact?: Point2D;
}): {
  bars: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  innerOffset: number | null;
} {
  const effectiveLength = Math.max(pathLength, 1);
  if (!Number.isFinite(effectiveLength) || effectiveLength <= 0) {
    return { bars: [], innerOffset: null };
  }

  const tolerance = 0.15;
  const barHeight = Math.min(Math.max(10, effectiveLength * 0.28), 20);
  const halfPerp = barHeight;
  const perpX = -unitY;
  const perpY = unitX;
  const maxOffset = Math.max(0, effectiveLength - 0.75);
  const outerOffset = 0;
  const minGap = Math.max(6, Math.min(18, effectiveLength * 0.24));
  const preferredGap = Math.max(minGap, Math.min(22, effectiveLength * 0.28));

  let innerOffset = outerOffset + preferredGap;
  if (innerOffset > maxOffset) {
    const available = Math.max(0, maxOffset - outerOffset);
    const fallbackGap = Math.max(minGap, available);
    innerOffset = outerOffset + fallbackGap;
  }
  innerOffset = Math.min(maxOffset, innerOffset);

  if (innerOffset - outerOffset < minGap && maxOffset - outerOffset >= minGap) {
    innerOffset = Math.min(maxOffset, outerOffset + minGap);
  }

  if (innerOffset - outerOffset < tolerance && maxOffset > outerOffset + tolerance) {
    innerOffset = Math.min(
      maxOffset,
      outerOffset + Math.max(minGap * 0.6, tolerance * 2),
    );
  }

  const offsets: number[] = [outerOffset];
  if (innerOffset - outerOffset > tolerance) {
    offsets.push(innerOffset);
  } else if (maxOffset > outerOffset + minGap * 0.6) {
    offsets.push(Math.min(maxOffset, outerOffset + Math.max(minGap * 0.6, tolerance * 2)));
  }

  const uniqueOffsets: number[] = [];
  offsets.forEach((offset) => {
    const clamped = Math.max(outerOffset, Math.min(offset, maxOffset));
    if (!uniqueOffsets.some((existing) => Math.abs(existing - clamped) < tolerance)) {
      uniqueOffsets.push(clamped);
    }
  });

  if (uniqueOffsets.length === 1 && maxOffset > outerOffset + minGap * 0.6) {
    const fallbackInner = Math.min(
      maxOffset,
      outerOffset + Math.max(minGap, preferredGap * 0.6),
    );
    if (!uniqueOffsets.some((existing) => Math.abs(existing - fallbackInner) < tolerance)) {
      uniqueOffsets.push(fallbackInner);
    }
  }

  uniqueOffsets.sort((a, b) => a - b);
  if (uniqueOffsets.length > 2) {
    uniqueOffsets.length = 2;
  }

  const positions: Array<Point2D> = [];
  const addPosition = (point: Point2D) => {
    if (
      positions.some(
        (existing) => Math.hypot(existing.x - point.x, existing.y - point.y) <= tolerance,
      )
    ) {
      return;
    }
    positions.push(point);
  };

  uniqueOffsets.forEach((offset) => {
    addPosition({
      x: startX + unitX * offset,
      y: startY + unitY * offset,
    });
    addPosition({
      x: endX - unitX * offset,
      y: endY - unitY * offset,
    });
  });

  if (positions.length === 0) {
    addPosition({ x: startX, y: startY });
    addPosition({ x: endX, y: endY });
  }

  const innerLimit = uniqueOffsets.length >= 2 ? uniqueOffsets[uniqueOffsets.length - 1] : null;
  const trimmedPositions = positions.slice(0, 4);

  return {
    bars: trimmedPositions.map((point) => ({
      x1: point.x + perpX * halfPerp,
      y1: point.y + perpY * halfPerp,
      x2: point.x - perpX * halfPerp,
      y2: point.y - perpY * halfPerp,
    })),
    innerOffset: innerLimit,
  };
}

const COLLISION_EPSILON = 1e-5;

function calculateNodeCollisionPoint(
  tail: Point2D,
  head: Point2D,
  headWidth: number,
  headHeight: number,
): Point2D {
  const deltaX = tail.x - head.x;
  const deltaY = tail.y - head.y;

  const halfWidth = Math.max(headWidth / 2, COLLISION_EPSILON);
  const halfHeight = Math.max(headHeight / 2, COLLISION_EPSILON);

  if (Math.abs(deltaX) < COLLISION_EPSILON) {
    return {
      x: head.x,
      y: head.y + (deltaY > 0 ? halfHeight : -halfHeight),
    };
  }

  if (Math.abs(deltaY) < COLLISION_EPSILON) {
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

function shouldRenderStraightSegment(dx: number, dy: number, lengthOverride?: number): boolean {
  const length = lengthOverride ?? Math.hypot(dx, dy);
  if (!Number.isFinite(length)) {
    return true;
  }
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const straightnessRatio = Math.min(absDx, absDy) / Math.max(absDx, absDy || 1);
  const isSameLayer = absDy < 12;
  const isVertical = absDx < 12;
  return straightnessRatio < 0.08 || isSameLayer || isVertical || length < 36;
}

function buildDependentCap({
  baseX,
  baseY,
  tipX,
  tipY,
  normalX,
  normalY,
  effectiveLength,
}: {
  baseX: number;
  baseY: number;
  tipX: number;
  tipY: number;
  normalX: number;
  normalY: number;
  effectiveLength: number;
}): string | undefined {
  const capLength = Math.hypot(tipX - baseX, tipY - baseY);
  if (!Number.isFinite(capLength) || capLength < 1) {
    return undefined;
  }
  const normLength = Math.hypot(normalX, normalY) || 1;
  const unitNormalX = normalX / normLength;
  const unitNormalY = normalY / normLength;
  const unitTangentX = -unitNormalY;
  const unitTangentY = unitNormalX;
  const capWidth = Math.min(Math.max(10, effectiveLength * 0.28), 20);
  const halfWidth = capWidth / 2;

  const p1x = baseX + unitTangentX * halfWidth;
  const p1y = baseY + unitTangentY * halfWidth;
  const p2x = baseX - unitTangentX * halfWidth;
  const p2y = baseY - unitTangentY * halfWidth;
  const p3x = tipX - unitTangentX * halfWidth;
  const p3y = tipY - unitTangentY * halfWidth;
  const p4x = tipX + unitTangentX * halfWidth;
  const p4y = tipY + unitTangentY * halfWidth;

  return `M ${p1x} ${p1y} L ${p2x} ${p2y} L ${p3x} ${p3y} L ${p4x} ${p4y} Z`;
}

function computeEdgeSegments(
  edges: EdgeDescriptor[],
  positions: Record<string, NodePosition>,
  areaAnchorMembers?: Record<string, string[]>,
): EdgeSegment[] {
  const segments: EdgeSegment[] = [];

  edges.forEach((edge) => {
    const source = positions[edge.from];
    const target = positions[edge.to];
    if (!source || !target) return;

    const isAreaDetailEdge = edge.relation === 'A';
    const sourceCenter: Point2D = { x: source.centerX, y: source.centerY };
    const targetCenter: Point2D = { x: target.centerX, y: target.centerY };
    const sourceExitDefault = calculateNodeCollisionPoint(
      targetCenter,
      sourceCenter,
      Math.max(source.width, 1),
      Math.max(source.height, 1),
    );
    const targetEntryDefault = calculateNodeCollisionPoint(
      sourceCenter,
      targetCenter,
      Math.max(target.width, 1),
      Math.max(target.height, 1),
    );

    let startPoint: Point2D = { ...sourceExitDefault };
    let collisionPoint: Point2D = { ...targetEntryDefault };

    if (isAreaDetailEdge) {
      const memberIds = areaAnchorMembers?.[edge.from] ?? [];
      const memberCenters = memberIds
        .map((member) => positions[member])
        .filter((value): value is NodePosition => Boolean(value));
      const averageMemberCenterY =
        memberCenters.length > 0
          ? memberCenters.reduce((sum, node) => sum + node.centerY, 0) / memberCenters.length
          : sourceCenter.y;
      const sourceHalfHeight = Math.max(source.height / 2 - 6, 1);
      const clampedSourceY = Math.max(
        sourceCenter.y - sourceHalfHeight,
        Math.min(sourceCenter.y + sourceHalfHeight, averageMemberCenterY),
      );
      const targetHalfHeight = Math.max(target.height / 2 - 6, 1);
      const clampedTargetY = Math.max(
        targetCenter.y - targetHalfHeight,
        Math.min(targetCenter.y + targetHalfHeight, clampedSourceY),
      );

      startPoint = {
        x: sourceCenter.x + Math.max(source.width, 1) / 2,
        y: clampedSourceY,
      };
      collisionPoint = {
        x: targetCenter.x - Math.max(target.width, 1) / 2,
        y: clampedTargetY,
      };
    }

    const centerDx = targetCenter.x - sourceCenter.x;
    const centerDy = targetCenter.y - sourceCenter.y;
    const treatAsStraight = isAreaDetailEdge ? false : shouldRenderStraightSegment(centerDx, centerDy);

    if (!treatAsStraight && !isAreaDetailEdge) {
      let directionX = centerDx;
      if (Math.abs(directionX) < 1e-3) {
        directionX = collisionPoint.x - startPoint.x;
      }
      if (Math.abs(directionX) < 1e-3) {
        directionX = 1;
      }
      const horizontalSign = directionX >= 0 ? 1 : -1;

      let directionY = centerDy;
      if (Math.abs(directionY) < 1e-3) {
        directionY = collisionPoint.y - startPoint.y;
      }
      if (Math.abs(directionY) < 1e-3) {
        directionY = 1;
      }
      const verticalSign = directionY >= 0 ? 1 : -1;

      const sourceHalfHeight = Math.max(source.height, 1) / 2;
      const targetHalfWidth = Math.max(target.width, 1) / 2;
      startPoint = {
        x: sourceCenter.x,
        y: sourceCenter.y + verticalSign * sourceHalfHeight,
      };
      collisionPoint = {
        x: targetCenter.x - horizontalSign * targetHalfWidth,
        y: targetCenter.y,
      };
    }

    let startX = startPoint.x;
    let startY = startPoint.y;
    const collisionX = collisionPoint.x;
    const collisionY = collisionPoint.y;

    const toCollisionDx = collisionX - startX;
    const toCollisionDy = collisionY - startY;
    const toCollisionLength = Math.hypot(toCollisionDx, toCollisionDy);
    if (!Number.isFinite(toCollisionLength) || toCollisionLength < 1) {
      return;
    }
    const dirToCollisionX = toCollisionDx / toCollisionLength;
    const dirToCollisionY = toCollisionDy / toCollisionLength;

    let endX = collisionX;
    let endY = collisionY;
    let dependentBase: Point2D | null = null;
    let dependentTip: Point2D | null = null;

    const normalVectorX = targetCenter.x - collisionX;
    const normalVectorY = targetCenter.y - collisionY;
    const normalMagnitude = Math.hypot(normalVectorX, normalVectorY);
    const targetNormal =
      normalMagnitude > 0
        ? {
            x: normalVectorX / normalMagnitude,
            y: normalVectorY / normalMagnitude,
          }
        : null;

    if (edge.relation === 'D') {
      const rawCap = Math.min(Math.max(12, toCollisionLength * 0.35), 24);
      const maxAvailable = Math.max(toCollisionLength - 8, 0);
      const capLength = Math.min(rawCap, maxAvailable);
      if (capLength > 1) {
        if (targetNormal) {
          endX = collisionX - targetNormal.x * capLength;
          endY = collisionY - targetNormal.y * capLength;
          dependentBase = { x: endX, y: endY };
          dependentTip = { x: collisionX, y: collisionY };
        } else {
          endX = collisionX - dirToCollisionX * capLength;
          endY = collisionY - dirToCollisionY * capLength;
          dependentBase = { x: endX, y: endY };
          dependentTip = { x: collisionX, y: collisionY };
        }
      }
    }

    let arrowPath: string | null = null;

    if (edge.relation === 'I' && targetNormal) {
      const maxApproach = Math.max(toCollisionLength - 4, 0);
      const arrowLength = Math.min(Math.max(18, toCollisionLength * 0.45), maxApproach);
      if (arrowLength > 8) {
        endX = collisionX - targetNormal.x * arrowLength;
        endY = collisionY - targetNormal.y * arrowLength;
        const arrowWidth = Math.min(Math.max(12, arrowLength * 0.62), 26);
        const unitTangentX = -targetNormal.y;
        const unitTangentY = targetNormal.x;
        const halfWidth = arrowWidth / 2;
        const leftBaseX = endX + unitTangentX * halfWidth;
        const leftBaseY = endY + unitTangentY * halfWidth;
        const rightBaseX = endX - unitTangentX * halfWidth;
        const rightBaseY = endY - unitTangentY * halfWidth;
        arrowPath = `M ${leftBaseX} ${leftBaseY} L ${collisionX} ${collisionY} L ${rightBaseX} ${rightBaseY} Z`;
      }
    }

    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1) return;

    const unitX = dx / length;
    const unitY = dy / length;

    let parallelInfo: ReturnType<typeof buildParallelBars> | null = null;
    let curveStartX = startX;
    let curveStartY = startY;
    let curveEndX = endX;
    let curveEndY = endY;
    let curveDx = dx;
    let curveDy = dy;
    let curveUnitX = unitX;
    let curveUnitY = unitY;
    let truncatedForParallel = false;

    if (edge.relation === 'P') {
      parallelInfo = buildParallelBars({
        startX,
        startY,
        endX,
        endY,
        unitX,
        unitY,
        pathLength: length,
        targetContact: { x: collisionX, y: collisionY },
      });
      const innerOffset = parallelInfo.innerOffset;
      if (
        innerOffset !== null &&
        innerOffset > 0.2 &&
        innerOffset * 2 < length - 0.2
      ) {
        const truncatedStartX = startX + unitX * innerOffset;
        const truncatedStartY = startY + unitY * innerOffset;
        const truncatedEndX = endX - unitX * innerOffset;
        const truncatedEndY = endY - unitY * innerOffset;
        const truncatedDx = truncatedEndX - truncatedStartX;
        const truncatedDy = truncatedEndY - truncatedStartY;
        const truncatedLength = Math.hypot(truncatedDx, truncatedDy);
        if (Number.isFinite(truncatedLength) && truncatedLength >= 0.5) {
          curveStartX = truncatedStartX;
          curveStartY = truncatedStartY;
          curveEndX = truncatedEndX;
          curveEndY = truncatedEndY;
          curveDx = truncatedDx;
          curveDy = truncatedDy;
          curveUnitX = truncatedDx / truncatedLength;
          curveUnitY = truncatedDy / truncatedLength;
          truncatedForParallel = true;
        }
      }
    }

    let path: string;
    if (isAreaDetailEdge) {
      const deltaX = endX - startX;
      const horizontalDistance = Math.max(1, Math.abs(deltaX));
      const arcMagnitude = Math.max(Math.min(horizontalDistance * 0.42, 130), 26);
      const direction = deltaX >= 0 ? 1 : -1;
      const c1x = startX + direction * arcMagnitude;
      const c1y = startY;
      const c2x = endX - direction * arcMagnitude * 0.65;
      const c2y = endY;
      path = `M ${startX} ${startY} C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${endY}`;
    } else {
      const pathSegments: string[] = [`M ${sourceCenter.x} ${sourceCenter.y}`];
      if (Math.abs(sourceCenter.x - startX) > 1e-2 || Math.abs(sourceCenter.y - startY) > 1e-2) {
        pathSegments.push(`L ${startX} ${startY}`);
      }
      if (truncatedForParallel) {
        pathSegments.push(`M ${curveStartX} ${curveStartY}`);
      }

      const curvePath = buildCurvedPath({
        startX: curveStartX,
        startY: curveStartY,
        endX: curveEndX,
        endY: curveEndY,
        dx: curveDx,
        dy: curveDy,
        unitX: curveUnitX,
        unitY: curveUnitY,
      });
      const curveWithoutMove = curvePath.replace(
        /^M\s*[-+]?[\d.]+(?:e[-+]?\d+)?\s+[-+]?[\d.]+(?:e[-+]?\d+)?\s*/i,
        '',
      );
      if (curveWithoutMove.trim().length > 0) {
        pathSegments.push(curveWithoutMove.trimStart());
      }

      path = pathSegments.join(' ');
    }

    const segment: EdgeSegment = {
      id: edge.id,
      relation: edge.relation,
      path,
      color: edge.color,
    };

    if (edge.relation === 'P') {
      if (parallelInfo && parallelInfo.bars.length > 0) {
        segment.bars = parallelInfo.bars;
      } else {
        segment.bars = [];
      }
    } else if (edge.relation === 'D' && dependentBase && dependentTip) {
      const cap = buildDependentCap({
        baseX: dependentBase.x,
        baseY: dependentBase.y,
        tipX: dependentTip.x,
        tipY: dependentTip.y,
        normalX: targetNormal?.x ?? unitX,
        normalY: targetNormal?.y ?? unitY,
        effectiveLength: toCollisionLength,
      });
      if (cap) {
        segment.capPath = cap;
      }
    } else if (arrowPath) {
      segment.arrowPath = arrowPath;
    }

    segments.push(segment);
  });

  return segments;
}

function buildCurvedPath({
  startX,
  startY,
  endX,
  endY,
  dx,
  dy,
  unitX,
  unitY,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  dx: number;
  dy: number;
  unitX: number;
  unitY: number;
}): string {
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  if (shouldRenderStraightSegment(dx, dy, length)) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const midpointX = (startX + endX) / 2;
  const midpointY = (startY + endY) / 2;

  let bendDirection: number;
  // Prefer bending along the dominant axis to keep the arc predictable.
  if (absDx >= absDy) {
    bendDirection = dy >= 0 ? 1 : -1;
  } else {
    bendDirection = dx <= 0 ? 1 : -1;
  }
  if (!Number.isFinite(bendDirection) || bendDirection === 0) {
    bendDirection = 1;
  }

  const baseCurve = length * 0.5;
  // Clamp curvature so short edges still get a gentle circular-looking arc.
  const maxCurve = Math.max(36, length * 0.65);
  const curveStrength = Math.min(
    Math.max(baseCurve, 18),
    maxCurve,
    length * 1.2,
  );
  const perpX = -unitY * bendDirection;
  const perpY = unitX * bendDirection;

  const controlX = midpointX + perpX * curveStrength;
  const controlY = midpointY + perpY * curveStrength;

  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
}

function buildNeighbourMap(edges: EdgeDescriptor[]): Map<string, Set<string>> {
  const neighbourMap = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (!neighbourMap.has(edge.from)) neighbourMap.set(edge.from, new Set());
    if (!neighbourMap.has(edge.to)) neighbourMap.set(edge.to, new Set());
    neighbourMap.get(edge.from)!.add(edge.to);
    neighbourMap.get(edge.to)!.add(edge.from);
  });
  return neighbourMap;
}

function countIntermediateObstacles(
  edge: EdgeDescriptor,
  columns: Record<string, number>,
  nodeLevelIndex: Map<string, number>,
  nodesByLevelIndex: Map<number, string[]>,
): number {
  const sourceLevel = nodeLevelIndex.get(edge.from);
  const targetLevel = nodeLevelIndex.get(edge.to);
  if (
    sourceLevel === undefined ||
    targetLevel === undefined ||
    sourceLevel === targetLevel
  ) {
    return 0;
  }

  const startLevel = Math.min(sourceLevel, targetLevel);
  const endLevel = Math.max(sourceLevel, targetLevel);
  const startColumn = sourceLevel <= targetLevel ? columns[edge.from] : columns[edge.to];
  const endColumn = sourceLevel <= targetLevel ? columns[edge.to] : columns[edge.from];

  if (startColumn === undefined || endColumn === undefined) {
    return 0;
  }

  const levelSpan = endLevel - startLevel;
  if (levelSpan <= 0) {
    return 0;
  }

  let intersections = 0;
  for (let levelIndex = startLevel + 1; levelIndex < endLevel; levelIndex += 1) {
    const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
    if (nodesAtLevel.length === 0) continue;
    const ratio = (levelIndex - startLevel) / levelSpan;
    const interpolatedColumn = startColumn + (endColumn - startColumn) * ratio;
    nodesAtLevel.forEach((nodeId) => {
      if (nodeId === edge.from || nodeId === edge.to) return;
      const nodeColumn = columns[nodeId];
      if (nodeColumn === undefined) return;
      if (Math.abs(nodeColumn - interpolatedColumn) < 0.45) {
        intersections += 1;
      }
    });
  }

  return intersections;
}

type AdjustmentDirection = 'top-down' | 'bottom-up';

function adjustPositionsForLevel(
  descriptors: LevelNodeDescriptor[],
  positions: Map<string, number>,
  neighbourMap: Map<string, Set<string>>,
  nodeLevelIndex: Map<string, number>,
  direction: AdjustmentDirection,
) {
  if (descriptors.length === 0) return;

  const spacing = 1;
  const candidates = descriptors.map((descriptor, index) => {
    const neighbours = neighbourMap.get(descriptor.id);
    const neighbourPositions = neighbours
      ? Array.from(neighbours)
          .map((neighbour) => positions.get(neighbour))
          .filter((value): value is number => value !== undefined && Number.isFinite(value))
      : [];
    let weightedSum = 0;
    let totalWeight = 0;
    neighbours?.forEach((neighbour) => {
      const neighbourPosition = positions.get(neighbour);
      if (neighbourPosition === undefined) return;
      const neighbourLevelIndex = nodeLevelIndex.get(neighbour);
      if (neighbourLevelIndex === undefined) return;
      const levelDelta = neighbourLevelIndex - descriptor.levelIndex;
      if (direction === 'top-down' && levelDelta >= 0) return;
      if (direction === 'bottom-up' && levelDelta <= 0) return;
      const distance = Math.abs(levelDelta) || 1;
      let weight = 1 / distance;
      if (direction === 'top-down') {
        weight *= 1.6;
      }
      weightedSum += neighbourPosition * weight;
      totalWeight += weight;
    });

    const desired =
      totalWeight > 0
        ? weightedSum / totalWeight
        : neighbourPositions.length > 0
          ? neighbourPositions.reduce((acc, value) => acc + value, 0) / neighbourPositions.length
          : positions.get(descriptor.id) ?? index;

    return { descriptor, desired, index };
  });

  candidates.sort((a, b) => {
    if (a.desired === b.desired) {
      return a.descriptor.orderHint - b.descriptor.orderHint;
    }
    return a.desired - b.desired;
  });

  let current = Number.NEGATIVE_INFINITY;
  candidates.forEach((entry) => {
    const desired = Number.isFinite(entry.desired) ? entry.desired : entry.index;
    current = Math.max(current + spacing, desired);
    positions.set(entry.descriptor.id, current);
  });
}

function prepareGridLayout(layers: ProcessLayer[], edges: EdgeDescriptor[]): LayoutInfo {
  const levelNodeMap = new Map<number, LevelNodeDescriptor[]>();
  const neighbourMap = buildNeighbourMap(edges);
  const nodeLevelIndex = new Map<string, number>();
  const nodesByLevelIndex = new Map<number, string[]>();
  const levelOrder = layers.map((layer) => layer.level);

  let orderHintCounter = 0;

  layers.forEach((layer, layerIndex) => {
    const levelNodes: LevelNodeDescriptor[] = levelNodeMap.get(layer.level) ?? [];
    if (!nodesByLevelIndex.has(layerIndex)) {
      nodesByLevelIndex.set(layerIndex, []);
    }
    layer.areas.forEach((area) => {
      area.objectTypes.forEach((objectType) => {
        levelNodes.push({
          id: objectType,
          areaId: area.id,
          orderHint: orderHintCounter,
          levelKey: layer.level,
          levelIndex: layerIndex,
        });
        nodeLevelIndex.set(objectType, layerIndex);
        nodesByLevelIndex.get(layerIndex)!.push(objectType);
        orderHintCounter += 1;
      });
    });
    levelNodeMap.set(layer.level, levelNodes);
  });

  const positions = new Map<string, number>();
  levelNodeMap.forEach((nodes) => {
    nodes.forEach((descriptor, index) => {
      positions.set(descriptor.id, index);
    });
  });

  const iterations = levelOrder.length > 1 ? 5 : 1;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 1; i < levelOrder.length; i += 1) {
      const levelKey = levelOrder[i];
      const descriptors = levelNodeMap.get(levelKey) ?? [];
      adjustPositionsForLevel(descriptors, positions, neighbourMap, nodeLevelIndex, 'top-down');
    }

    for (let i = levelOrder.length - 2; i >= 0; i -= 1) {
      const levelKey = levelOrder[i];
      const descriptors = levelNodeMap.get(levelKey) ?? [];
      adjustPositionsForLevel(descriptors, positions, neighbourMap, nodeLevelIndex, 'bottom-up');
    }
  }

  levelOrder.forEach((levelKey) => {
    const descriptors = levelNodeMap.get(levelKey) ?? [];
    const ordered = descriptors
      .slice()
      .sort((a, b) => {
        const posA = positions.get(a.id) ?? 0;
        const posB = positions.get(b.id) ?? 0;
        if (posA === posB) {
          return a.orderHint - b.orderHint;
        }
        return posA - posB;
      });

    let last = Number.NEGATIVE_INFINITY;
    ordered.forEach((descriptor) => {
      const raw = positions.get(descriptor.id) ?? 0;
      let column = Math.round(raw);
      if (!Number.isFinite(column)) column = 0;
      if (column <= last) column = last + 1;
      positions.set(descriptor.id, column);
      last = column;
    });
  });

  const allValues = Array.from(positions.values());
  const minColumn = allValues.length > 0 ? Math.min(...allValues) : 0;
  if (Number.isFinite(minColumn) && minColumn !== 0) {
    positions.forEach((value, key) => {
      positions.set(key, value - minColumn);
    });
  }

  const nodeColumns: Record<string, number> = {};
  positions.forEach((value, key) => {
    nodeColumns[key] = value;
  });

  const evaluateCrossings = (columns: Record<string, number>) => {
    let total = 0;
    edges.forEach((edge) => {
      total += countIntermediateObstacles(edge, columns, nodeLevelIndex, nodesByLevelIndex);
    });
    return total;
  };

  if (edges.length > 0) {
    const levelOccupancy = new Map<number, Set<number>>();
    nodeLevelIndex.forEach((levelIndex, nodeId) => {
      const column = nodeColumns[nodeId];
      if (column === undefined) return;
      if (!levelOccupancy.has(levelIndex)) {
        levelOccupancy.set(levelIndex, new Set());
      }
      levelOccupancy.get(levelIndex)!.add(column);
    });

    let globalScore = evaluateCrossings(nodeColumns);
    const deltas = [0, -1, 1, -2, 2];

    for (let iteration = 0; iteration < 4; iteration += 1) {
      let improved = false;
      for (let levelIndex = 0; levelIndex < levelOrder.length; levelIndex += 1) {
        const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
        let occupancy = levelOccupancy.get(levelIndex);
        if (!occupancy) {
          occupancy = new Set<number>();
          levelOccupancy.set(levelIndex, occupancy);
        }
        nodesAtLevel.forEach((nodeId) => {
          const currentColumn = nodeColumns[nodeId];
          if (currentColumn === undefined) return;
          let bestColumn = currentColumn;
          let bestScore = globalScore;
          occupancy.delete(currentColumn);

          deltas.forEach((delta) => {
            const candidate = currentColumn + delta;
            if (candidate < 0) return;
            if (occupancy.has(candidate)) return;
            nodeColumns[nodeId] = candidate;
            occupancy.add(candidate);
            const candidateScore = evaluateCrossings(nodeColumns);
            occupancy.delete(candidate);
            nodeColumns[nodeId] = currentColumn;
            if (candidateScore + 1e-6 < bestScore) {
              bestScore = candidateScore;
              bestColumn = candidate;
            }
          });

          occupancy.add(currentColumn);

          if (bestColumn !== currentColumn) {
            occupancy.delete(currentColumn);
            occupancy.add(bestColumn);
            nodeColumns[nodeId] = bestColumn;
            globalScore = bestScore;
            improved = true;
          } else {
            nodeColumns[nodeId] = currentColumn;
          }
        });
      }
      if (!improved) break;
    }

    nodesByLevelIndex.forEach((nodeIds) => {
      nodeIds.forEach((nodeId) => {
        const column = nodeColumns[nodeId];
        if (column !== undefined) {
          positions.set(nodeId, column);
        }
      });
    });
  }

  positions.forEach((_, key) => {
    const column = nodeColumns[key];
    if (column !== undefined) {
      positions.set(key, column);
    }
  });

  const areaPlacements: Record<string, { startColumn: number; span: number }> = {};
  const levelAreaCursor = new Map<number, number>();

  layers.forEach((layer) => {
    let cursor = levelAreaCursor.get(layer.level) ?? 0;
    layer.areas.forEach((area) => {
      if (area.objectTypes.length === 0) {
        areaPlacements[area.id] = { startColumn: cursor, span: 1 };
        cursor += 1;
      } else {
        const columns = area.objectTypes
          .map((objectType) => nodeColumns[objectType])
          .filter((value): value is number => value !== undefined);
        if (columns.length === 0) {
          areaPlacements[area.id] = { startColumn: cursor, span: 1 };
          cursor += 1;
        } else {
          const minCol = Math.min(...columns);
          const maxCol = Math.max(...columns);
          areaPlacements[area.id] = { startColumn: minCol, span: Math.max(1, maxCol - minCol + 1) };
          cursor = Math.max(cursor, maxCol + 1);
        }
      }
    });
    levelAreaCursor.set(layer.level, cursor);
  });

  const totalColumns =
    Object.keys(nodeColumns).length > 0
      ? Math.max(
          ...Object.values(nodeColumns).concat(
            Object.values(areaPlacements).map((placement) => placement.startColumn + placement.span - 1),
          ),
        ) + 1
      : Math.max(
          0,
          ...Object.values(areaPlacements).map((placement) => placement.startColumn + placement.span),
        );

  return {
    nodeColumns,
    areaPlacements,
    totalColumns,
  };
}

function computeLevelAssignments(data: TotemApiResponse): Map<string, number> {
  const nodes = new Set<string>();

  const ensureNode = (node: string | undefined | null) => {
    if (!node) return;
    nodes.add(node);
  };

  (data.tempgraph?.nodes ?? []).forEach((node) => ensureNode(node));

  const collectEdgeNodes = (edges?: unknown) => {
    if (!Array.isArray(edges)) return;
    (edges as string[][]).forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        ensureNode(pair[0]);
        ensureNode(pair[1]);
      }
    });
  };

  collectEdgeNodes(data.tempgraph?.D);
  collectEdgeNodes((data.tempgraph as Record<string, unknown>)?.Di);
  collectEdgeNodes(data.tempgraph?.P);

  class UnionFind {
    private parent = new Map<string, string>();
    private rank = new Map<string, number>();

    constructor(values: Iterable<string>) {
      Array.from(values).forEach((value) => {
        this.parent.set(value, value);
        this.rank.set(value, 0);
      });
    }

    find(value: string): string {
      const parentValue = this.parent.get(value);
      if (!parentValue || parentValue === value) return value;
      const root = this.find(parentValue);
      this.parent.set(value, root);
      return root;
    }

    union(a?: string, b?: string) {
      if (!a || !b) return;
      const rootA = this.find(a);
      const rootB = this.find(b);
      if (rootA === rootB) return;
      const rankA = this.rank.get(rootA) ?? 0;
      const rankB = this.rank.get(rootB) ?? 0;
      if (rankA < rankB) {
        this.parent.set(rootA, rootB);
      } else if (rankA > rankB) {
        this.parent.set(rootB, rootA);
      } else {
        this.parent.set(rootB, rootA);
        this.rank.set(rootA, rankA + 1);
      }
    }
  }

  const unionFind = new UnionFind(nodes);

  const parallelEdges = data.tempgraph?.P as string[][];
  if (Array.isArray(parallelEdges)) {
    parallelEdges.forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        unionFind.union(pair[0], pair[1]);
      }
    });
  }

  const componentByNode = new Map<string, string>();
  nodes.forEach((node) => {
    componentByNode.set(node, unionFind.find(node));
  });

  const componentAdjacency = new Map<string, Set<string>>();
  const componentIndegree = new Map<string, number>();

  const ensureComponent = (component: string) => {
    if (!componentAdjacency.has(component)) componentAdjacency.set(component, new Set());
    if (!componentIndegree.has(component)) componentIndegree.set(component, 0);
  };

  componentByNode.forEach((component) => ensureComponent(component));

  const registerComponentEdge = (source?: string, target?: string) => {
    if (!source || !target) return;
    const sourceComponent = componentByNode.get(source);
    const targetComponent = componentByNode.get(target);
    if (!sourceComponent || !targetComponent || sourceComponent === targetComponent) return;
    ensureComponent(sourceComponent);
    ensureComponent(targetComponent);
    const neighbours = componentAdjacency.get(sourceComponent)!;
    if (!neighbours.has(targetComponent)) {
      neighbours.add(targetComponent);
      componentIndegree.set(targetComponent, (componentIndegree.get(targetComponent) ?? 0) + 1);
    }
  };

  const dependentEdges = data.tempgraph?.D as string[][];
  if (Array.isArray(dependentEdges)) {
    dependentEdges.forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        registerComponentEdge(pair[0], pair[1]);
      }
    });
  }

  const dependentInverseEdges = (data.tempgraph as Record<string, unknown>)?.Di as string[][];
  if (Array.isArray(dependentInverseEdges)) {
    dependentInverseEdges.forEach((pair) => {
      if (Array.isArray(pair) && pair.length >= 2) {
        registerComponentEdge(pair[1], pair[0]);
      }
    });
  }

  const componentQueue: string[] = [];
  componentIndegree.forEach((value, component) => {
    if (value === 0) {
      componentQueue.push(component);
    }
  });

  const componentLevels = new Map<string, number>();
  const visitedComponents = new Set<string>();

  componentQueue.forEach((component) => {
    if (!componentLevels.has(component)) {
      componentLevels.set(component, 0);
    }
  });

  while (componentQueue.length > 0) {
    const component = componentQueue.shift()!;
    visitedComponents.add(component);
    const currentLevel = componentLevels.get(component) ?? 0;

    componentAdjacency.get(component)?.forEach((neighbour) => {
      const proposed = currentLevel + 1;
      const previous = componentLevels.get(neighbour) ?? 0;
      if (proposed > previous) {
        componentLevels.set(neighbour, proposed);
      }
      const remaining = (componentIndegree.get(neighbour) ?? 0) - 1;
      componentIndegree.set(neighbour, remaining);
      if (remaining <= 0 && !visitedComponents.has(neighbour)) {
        componentQueue.push(neighbour);
      }
    });
  }

  const sortedComponents = Array.from(new Set(componentByNode.values())).sort((a, b) => a.localeCompare(b));
  sortedComponents.forEach((component) => {
    if (!componentLevels.has(component)) {
      componentLevels.set(component, 0);
    }
  });

  const nodeLevels = new Map<string, number>();

  componentByNode.forEach((component, node) => {
    nodeLevels.set(node, componentLevels.get(component) ?? 0);
  });

  const levelValues = Array.from(nodeLevels.values());
  const minLevel = levelValues.length > 0 ? Math.min(...levelValues) : 0;
  if (minLevel !== 0 && Number.isFinite(minLevel)) {
    nodeLevels.forEach((value, key) => {
      nodeLevels.set(key, value - minLevel);
    });
  }

  return nodeLevels;
}

function computeProcessAreas(
  levels: Map<string, number>,
  typeRelations?: Array<string[]>,
): ProcessAreaDefinition[] {
  const nodesByLevel = new Map<number, string[]>();
  levels.forEach((level, node) => {
    const numericLevel = Number.isFinite(level) ? level : 0;
    if (!nodesByLevel.has(numericLevel)) {
      nodesByLevel.set(numericLevel, []);
    }
    nodesByLevel.get(numericLevel)!.push(node);
  });

  const adjacency = new Map<string, Set<string>>();
  typeRelations?.forEach((relation) => {
    if (!Array.isArray(relation)) return;
    for (let i = 0; i < relation.length; i += 1) {
      for (let j = i + 1; j < relation.length; j += 1) {
        const a = relation[i];
        const b = relation[j];
        if (!a || !b) continue;
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
      }
    }
  });

  const areas: ProcessAreaDefinition[] = [];
  const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);

  sortedLevels.forEach((level) => {
    const nodes = nodesByLevel.get(level)?.slice().sort((a, b) => a.localeCompare(b)) ?? [];
    const seen = new Set<string>();
    let areaIndex = 0;

    nodes.forEach((node) => {
      if (seen.has(node)) return;
      const stack = [node];
      const group: string[] = [];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        group.push(current);
        adjacency.get(current)?.forEach((neighbour) => {
          if (!seen.has(neighbour) && (levels.get(neighbour) ?? level) === level) {
            stack.push(neighbour);
          }
        });
      }

      group.sort((a, b) => a.localeCompare(b));
      const alphabetIndex = String.fromCharCode(65 + (areaIndex % 26));
      const repetition = areaIndex >= 26 ? Math.floor(areaIndex / 26) + 1 : '';
      const suffix = group.length > 0 ? `-${alphabetIndex}${repetition}` : '';
      areas.push({
        id: `process-area-${level}-${areaIndex}`,
        level,
        label: `Process Area ${level}${suffix}`,
        objectTypes: group,
      });
      areaIndex += 1;
    });

    if (nodes.length === 0 && !areas.some((area) => area.level === level)) {
      areas.push({
        id: `process-area-${level}-empty`,
        level,
        label: `Process Area ${level}`,
        objectTypes: [],
      });
    }
  });

  return areas;
}

function buildLayers(data: TotemApiResponse): ProcessLayer[] {
  const levels = computeLevelAssignments(data);
  if (levels.size === 0) return [];
  const areas = computeProcessAreas(levels, data.type_relations);
  const areasByLevel = new Map<number, ProcessAreaDefinition[]>();

  areas.forEach((area) => {
    if (!areasByLevel.has(area.level)) {
      areasByLevel.set(area.level, []);
    }
    areasByLevel.get(area.level)!.push(area);
  });

  areasByLevel.forEach((entries) => {
    entries.sort((a, b) => a.label.localeCompare(b.label));
  });

  const sortedLevels = Array.from(areasByLevel.keys()).sort((a, b) => b - a);
  return sortedLevels.map((level) => ({
    level,
    areas: areasByLevel.get(level) ?? [],
  }));
}

function selectDetailMock(area: ProcessAreaDefinition): OcdfgMockData {
  const label = (area.label || '').toLowerCase();
  const types = area.objectTypes.map((t) => t.toLowerCase());
  const has = (keyword: string) => label.includes(keyword) || types.some((t) => t.includes(keyword));

  if (has('order') || has('item')) return orderItemOcdfgMock;
  if (has('hr') || has('human')) return hrWorkerOcdfgMock;
  if (has('worker')) return hrWorkerOcdfgMock;
  if (has('company')) return companyLifecycleOcdfgMock;
  if (has('factory')) return factoryOcdfgMock;
  if (has('warehouse')) return warehouseOcdfgMock;
  return ocdfgDetailMiniMock;
}

function TotemVisualizer({
  eventLogId,
  height = '100%',
  backendBaseUrl = DEFAULT_BACKEND,
}: TotemVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTotem, setRawTotem] = useState<TotemApiResponse | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const [edgeSegments, setEdgeSegments] = useState<EdgeSegment[]>([]);
  const [contentSize, setContentSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const assignNodeRef = useCallback((type: string, element: HTMLElement | null) => {
    if (element) {
      nodeRefs.current[type] = element;
    } else {
      delete nodeRefs.current[type];
    }
  }, []);
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});
  const [detailSizes, setDetailSizes] = useState<Record<string, { width: number; height: number }>>({});

  const layers = useMemo(() => (rawTotem ? buildLayers(rawTotem) : []), [rawTotem]);
  const typeColorMap = useMemo(
    () => mapTypesToColors(rawTotem?.tempgraph?.nodes ?? []),
    [rawTotem?.tempgraph?.nodes],
  );
  const baseEdges = useMemo(
    () => extractEdges(rawTotem?.tempgraph),
    [rawTotem?.tempgraph],
  );
  const dynamicAreaEdges = useMemo(() => {
    const descriptors: EdgeDescriptor[] = [];
    Object.entries(expandedAreas).forEach(([areaId, expanded]) => {
      if (!expanded) return;
      descriptors.push({
        id: `area-detail-${areaId}`,
        relation: 'A',
        from: `${areaId}::anchor`,
        to: `${areaId}::detail`,
        color: DETAIL_EDGE_STROKE,
      });
    });
    return descriptors;
  }, [expandedAreas]);
  const allEdges = useMemo(
    () => [...baseEdges, ...dynamicAreaEdges],
    [baseEdges, dynamicAreaEdges],
  );
  const areaAnchorMembers = useMemo(() => {
    const map: Record<string, string[]> = {};
    layers.forEach((layer) => {
      layer.areas.forEach((area) => {
        map[`${area.id}::anchor`] = area.objectTypes.slice();
      });
    });
    return map;
  }, [layers]);
  const layoutInfo = useMemo(() => prepareGridLayout(layers, allEdges), [layers, allEdges]);
  const totalColumns = Math.max(layoutInfo.totalColumns, 1);
  const levelGridTemplate = `repeat(${totalColumns}, ${COLUMN_WIDTH}px)`;
  const levelMinimumWidth = totalColumns * COLUMN_WIDTH;
  const areaPlacements = layoutInfo.areaPlacements;
  const nodeColumns = layoutInfo.nodeColumns;
  const detailEdgeSegments = useMemo(
    () => edgeSegments.filter((segment) => segment.relation === 'A'),
    [edgeSegments],
  );
  const primaryEdgeSegments = useMemo(
    () => edgeSegments.filter((segment) => segment.relation !== 'A'),
    [edgeSegments],
  );
  const toggleAreaDetail = useCallback((areaId: string) => {
    setExpandedAreas((prev) => {
      if (prev[areaId]) {
        const { [areaId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [areaId]: true };
    });
  }, []);

  const fetchTotem = useCallback(async () => {
    if (!eventLogId) {
      setRawTotem(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(
        `${backendBaseUrl}/api/eventlogs/${eventLogId}/discover_totem/`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Backend responded with ${response.status}`);
      }

      const payload: TotemApiResponse = await response.json();
      setRawTotem(payload);
    } catch (err) {
      console.error('[TotemVisualizer] Failed to load Totem data', err);
      setError(err instanceof Error ? err.message : 'Failed to load Totem data');
      setRawTotem(null);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, eventLogId]);

  useEffect(() => {
    fetchTotem();
  }, [fetchTotem]);

  useEffect(() => {
    setExpandedAreas({});
    setDetailSizes({});
  }, [rawTotem?.tempgraph]);

  useLayoutEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) {
      setEdgeSegments([]);
      setContentSize({ width: 0, height: 0 });
      return;
    }

    let animationFrame: number | null = null;

    const measure = () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        if (!contentRef.current) return;
        const contentRect = contentRef.current.getBoundingClientRect();
        const positions: Record<string, NodePosition> = {};

        Object.entries(nodeRefs.current).forEach(([type, element]) => {
          if (!element) return;
          const rect = element.getBoundingClientRect();
          positions[type] = {
            centerX: rect.left - contentRect.left + rect.width / 2,
            centerY: rect.top - contentRect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
          };
        });

        const segments = computeEdgeSegments(allEdges, positions, areaAnchorMembers);
        setEdgeSegments(segments);
        setContentSize({
          width: Math.max(
            1,
            Math.ceil(contentRef.current.scrollWidth || contentRect.width),
          ),
          height: Math.max(
            1,
            Math.ceil(contentRef.current.scrollHeight || contentRect.height),
          ),
        });
      });
    };

    measure();

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => measure())
        : null;

    observer?.observe(contentEl);
    window.addEventListener('resize', measure);

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [allEdges, areaAnchorMembers, detailSizes, layers, rawTotem]);

  const computedHeight = resolveHeight(height);
  const hasLayers = layers.length > 0;

  return (
    <div className="relative flex-1" style={{ height: computedHeight, width: '100%' }}>
      {!eventLogId && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-md">
            <Badge variant="outline">Totem Visualizer</Badge>
            <p className="text-sm text-slate-600">Select an event log to discover its Totem model.</p>
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        style={{
          position: 'relative',
          height: '100%',
          width: '100%',
          overflow: 'auto',
          background: '#FFFFFF',
        }}
      >
        <div
          ref={contentRef}
          style={{
            position: 'relative',
            minHeight: '100%',
            padding: '32px 32px 72px',
            boxSizing: 'border-box',
          }}
        >
          {contentSize.width > 0 && contentSize.height > 0 && (
            <svg
              width={contentSize.width}
              height={contentSize.height}
              viewBox={`0 0 ${contentSize.width} ${contentSize.height}`}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
              {[detailEdgeSegments, primaryEdgeSegments].map((group, groupIndex) =>
                group.map((edge) => {
                  const strokeWidth =
                    edge.relation === 'D'
                      ? 3.2
                      : edge.relation === 'P'
                        ? 3
                        : edge.relation === 'A'
                          ? 2.2
                          : 2.6;
                  const strokeColor = edge.color ?? '#0F172A';
                  const barStrokeWidth = edge.relation === 'P' ? strokeWidth * 1.5 : strokeWidth;
                  return (
                    <g key={`${edge.id}-${groupIndex}`}>
                      <path
                        d={edge.path}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                      {edge.bars?.map((bar, index) => (
                        <line
                          key={`${edge.id}-bar-${groupIndex}-${index}`}
                          x1={bar.x1}
                          y1={bar.y1}
                          x2={bar.x2}
                          y2={bar.y2}
                          stroke={strokeColor}
                          strokeWidth={barStrokeWidth}
                          strokeLinecap="butt"
                        />
                      ))}
                      {edge.capPath && <path d={edge.capPath} fill={strokeColor} stroke="none" />}
                      {edge.arrowPath && (
                        <path d={edge.arrowPath} fill={strokeColor} stroke="none" />
                      )}
                    </g>
                  );
                }),
              )}
            </svg>
          )}

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button
                variant="outline"
                onClick={fetchTotem}
                disabled={!eventLogId || loading}
                className="flex items-center gap-2"
              >
                <RefreshCcw className="h-4 w-4" />
                Reload
              </Button>
            </div>

            {error && (
              <div
                style={{
                  marginBottom: 24,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(248, 113, 113, 0.4)',
                  background: 'rgba(254, 226, 226, 0.65)',
                  color: '#991B1B',
                  fontSize: 14,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span>{error}</span>
                <Button size="sm" variant="ghost" onClick={fetchTotem} disabled={loading}>
                  Retry
                </Button>
              </div>
            )}

            {hasLayers ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {layers.map((layer) => (
                  <section
                    key={`layer-${layer.level}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 24,
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: levelGridTemplate,
                          columnGap: 0,
                          rowGap: GRID_ROW_GAP,
                          flex: 1,
                          minWidth: levelMinimumWidth,
                          alignItems: 'start',
                        }}
                      >
                        {layer.areas.map((area) => {
                          const placement = areaPlacements[area.id] ?? { startColumn: 0, span: 1 };
                          const startColumn = Math.max(0, placement.startColumn);
                          const spanColumns = Math.max(1, placement.span);
                          const sortedObjectTypes = area.objectTypes
                            .slice()
                            .sort((a, b) => {
                              const colA = nodeColumns[a] ?? startColumn;
                              const colB = nodeColumns[b] ?? startColumn;
                              if (colA === colB) return a.localeCompare(b);
                              return colA - colB;
                            });
                          const templateColumns = `repeat(${spanColumns}, ${OBJECT_NODE_WIDTH}px)`;
                          const isExpanded = Boolean(expandedAreas[area.id]);
                          const areaAnchorId = `${area.id}::anchor`;
                          const detailNodeId = `${area.id}::detail`;
                          const detailBorder = PROCESS_AREA_BORDER;
                          const detailBackground = PROCESS_AREA_BACKGROUND;
                          const detailForeground = textColorForBackground(detailBackground, {
                            minContrast: 4,
                            gradientSamples: [],
                          });
                          const detailSize = detailSizes[area.id];
                          const ocdfgWidth = detailSize?.width ?? OBJECT_NODE_WIDTH;
                          const ocdfgHeight = detailSize?.height ?? OBJECT_NODE_MIN_HEIGHT;
                          const detailData = selectDetailMock(area);
                          const containerMinHeight = Math.max(
                            OBJECT_NODE_MIN_HEIGHT + 32,
                            isExpanded ? ocdfgHeight + 32 : OBJECT_NODE_MIN_HEIGHT + 32,
                          );

                          return (
                            <div
                              key={area.id}
                              style={{
                                gridColumn: `${startColumn + 1} / span ${spanColumns}`,
                                padding: `16px ${GRID_COLUMN_GAP / 2}px`,
                                display: 'grid',
                                gridTemplateColumns: templateColumns,
                                columnGap: GRID_COLUMN_GAP,
                                rowGap: GRID_ROW_GAP,
                                justifyItems: 'center',
                                alignItems: 'start',
                                position: 'relative',
                                minHeight: containerMinHeight,
                              }}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  borderRadius: 28,
                                  background: PROCESS_AREA_BACKGROUND,
                                  border: `1px solid ${PROCESS_AREA_BORDER}`,
                                  boxShadow: PROCESS_AREA_INSET_SHADOW,
                                  zIndex: 0,
                                  pointerEvents: 'none',
                                }}
                              />
                              <button
                                type="button"
                                ref={(element) => assignNodeRef(areaAnchorId, element)}
                                onClick={() => toggleAreaDetail(area.id)}
                                aria-pressed={isExpanded}
                                aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${area.label}`}
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  borderRadius: 28,
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  zIndex: 2,
                                }}
                              />
                              {sortedObjectTypes.length > 0 ? (
                                sortedObjectTypes.map((objectType) => {
                                  const baseColor = typeColorMap[objectType] ?? '#2563EB';
                                  const readableColor = textColorForBackground(baseColor, {
                                    minContrast: 3.8,
                                    gradientSamples: [],
                                  });
                                  const rawColumnIndex = (nodeColumns[objectType] ?? startColumn) - startColumn;
                                  const columnIndex = Math.max(0, Math.min(spanColumns - 1, rawColumnIndex));
                                  return (
                                    <span
                                      key={objectType}
                                      ref={(element) => assignNodeRef(objectType, element)}
                                      style={{
                                        padding: '16px 20px',
                                        borderRadius: 18,
                                        fontSize: 18,
                                        fontWeight: 600,
                                        color: readableColor,
                                        background: baseColor,
                                        border: `1px solid ${lighten(baseColor, 0.35)}`,
                                        lineHeight: 1.15,
                                        width: OBJECT_NODE_WIDTH,
                                        minHeight: OBJECT_NODE_MIN_HEIGHT,
                                        boxSizing: 'border-box',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        textAlign: 'center',
                                        wordBreak: 'break-word',
                                        position: 'relative',
                                        zIndex: 3,
                                        gridColumn: `${columnIndex + 1}`,
                                      }}
                                    >
                                      {objectType}
                                    </span>
                                  );
                                })
                              ) : (
                                <span
                                  style={{
                                    fontSize: 15,
                                    color: 'rgba(29, 78, 216, 0.65)',
                                    fontStyle: 'italic',
                                    gridColumn: '1 / -1',
                                    alignSelf: 'center',
                                    position: 'relative',
                                    zIndex: 3,
                                  }}
                                >
                                  No object types assigned yet
                                </span>
                              )}
                              {isExpanded && (
                                <div
                                  ref={(element) => assignNodeRef(detailNodeId, element)}
                                  style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: `calc(100% + ${GRID_COLUMN_GAP * 1.5}px)`,
                                    transform: 'translateY(-50%)',
                                    width: ocdfgWidth,
                                    minWidth: OBJECT_NODE_WIDTH,
                                    minHeight: OBJECT_NODE_MIN_HEIGHT,
                                    height: ocdfgHeight,
                                    borderRadius: 18,
                                    border: `1.5px solid ${detailBorder}`,
                                    background: 'transparent',
                                    display: 'flex',
                                    alignItems: 'stretch',
                                    justifyContent: 'center',
                                    zIndex: 1,
                                    boxSizing: 'border-box',
                                    boxShadow: 'inset 0 0 12px 3px rgba(37, 99, 235, 0.08)',
                                    color: detailForeground,
                                    pointerEvents: 'none',
                                    overflow: 'hidden',
                                  }}
                                >
                                  <OCDFGDetailVisualizer
                                    height={ocdfgHeight}
                                    data={detailData}
                                    instanceId={`detail-${area.id}`}
                                    typeColorOverrides={typeColorMap}
                                    onSizeChange={(size) => {
                                      setDetailSizes((prev) => {
                                        const existing = prev[area.id];
                                        if (
                                          existing &&
                                          existing.width === size.width &&
                                          existing.height === size.height
                                        ) {
                                          return prev;
                                        }
                                        return {
                                          ...prev,
                                          [area.id]: {
                                            width: size.width,
                                            height: size.height,
                                          },
                                        };
                                      });
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <header
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 3,
                          color: '#0F172A',
                          minWidth: 120,
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          Level {layer.level}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748B', textAlign: 'right' }}>
                          {layer.areas.reduce((acc, area) => acc + area.objectTypes.length, 0)} object
                          type{layer.areas.reduce((acc, area) => acc + area.objectTypes.length, 0) === 1 ? '' : 's'}
                        </span>
                      </header>
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              !loading && (
                <div
                  style={{
                    marginTop: 48,
                    borderRadius: 16,
                    border: '1px dashed #CBD5F5',
                    background: '#FFFFFF',
                    padding: '40px 48px',
                    textAlign: 'center',
                    color: '#475569',
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                    No process areas discovered yet
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                    Run Totem discovery for the selected event log to populate process layers and object types.
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <div className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-lg">
            Discovering Totem model…
          </div>
        </div>
      )}
    </div>
  );
}

export default TotemVisualizer;
