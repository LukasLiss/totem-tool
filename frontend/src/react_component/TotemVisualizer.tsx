import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScanIcon, FlaskConicalIcon, BrainIcon } from 'lucide-react';
import { mapTypesToColors, textColorForBackground } from '../utils/objectColors';
import OCDFGDetailVisualizer from './OCDFGDetailVisualizer';
import type { OcdfgGraph } from './OCDFGVisualizer';
import {
  orderItemOcdfgMock,
  hrWorkerOcdfgMock,
  companyLifecycleOcdfgMock,
  factoryOcdfgMock,
  warehouseOcdfgMock,
  ocdfgDetailMiniMock,
  type OcdfgMockData,
} from '@/mocks/ocdfgDetailMock';

type MlpaLayerArea = {
  objectTypes: string[];
  eventTypes: string[];
};

type MlpaLayer = {
  level: number;
  areas: MlpaLayerArea[];
};

type TotemApiResponse = {
  layers?: MlpaLayer[];
  tempgraph: {
    nodes?: string[];
    [relation: string]: string[] | string[][];
  };
  type_relations?: Array<string[]>;
  all_event_types?: string[];
  object_type_to_event_types?: Record<string, string[]>;
};

const TOTEM_MOCK: TotemApiResponse = {
  layers: [
    {
      level: 0,
      areas: [
        { objectTypes: ['Company'], eventTypes: ['Establish Company', 'Close Company'] },
      ],
    },
    {
      level: 1,
      areas: [
        { objectTypes: ['Factory', 'Warehouse'], eventTypes: ['Start Production', 'Maintain Equipment', 'Store Inventory', 'Dispatch Inventory'] },
        { objectTypes: ['HR'], eventTypes: ['Hire Worker', 'Process Contract'] },
      ],
    },
    {
      level: 2,
      areas: [
        { objectTypes: ['Worker'], eventTypes: ['Staff Shift', 'Relocate Worker'] },
      ],
    },
    {
      level: 3,
      areas: [
        { objectTypes: ['Order', 'Item'], eventTypes: ['Create Order', 'Complete Order', 'Package Item', 'Ship Item'] },
      ],
    },
  ],
  tempgraph: {
    nodes: ['Company', 'Factory', 'Warehouse', 'HR', 'Worker', 'Order', 'Item'],
    D: [
      ['Order', 'Worker'],
      ['Item', 'Worker'],
      ['Worker', 'Factory'],
      ['Item', 'Warehouse'],
      ['HR', 'Company'],
      ['Factory', 'Company'],
      ['Warehouse', 'Company'],
    ],
    P: [
      ['Factory', 'Warehouse'],
      ['Warehouse', 'Factory'],
      ['HR', 'Worker'],
      ['Worker', 'HR'],
    ],
    I: [['Order', 'Item']],
  },
  type_relations: [
    ['Company', 'Factory'],
    ['Company', 'Warehouse'],
    ['Company', 'Worker'],
    ['Factory', 'Warehouse'],
    ['Factory', 'Worker'],
    ['HR', 'Order'],
    ['HR', 'Worker'],
    ['Item', 'Worker'],
    ['Order', 'Item'],
    ['Order', 'Worker'],
  ],
  all_event_types: [
    'Close Company',
    'Complete Order',
    'Create Order',
    'Dispatch Inventory',
    'Establish Company',
    'Hire Worker',
    'Maintain Equipment',
    'Package Item',
    'Process Contract',
    'Relocate Worker',
    'Ship Item',
    'Staff Shift',
    'Start Production',
    'Store Inventory',
  ],
  object_type_to_event_types: {
    Company: ['Establish Company', 'Close Company'],
    Factory: ['Start Production', 'Maintain Equipment'],
    Warehouse: ['Store Inventory', 'Dispatch Inventory'],
    HR: ['Hire Worker', 'Process Contract'],
    Worker: ['Staff Shift', 'Relocate Worker'],
    Order: ['Create Order', 'Complete Order'],
    Item: ['Package Item', 'Ship Item'],
  },
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
  reloadSignal?: number;
  title?: string;
  topInset?: number;
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

type DetailSide = 'left' | 'right';
type Rect = { id: string; left: number; right: number; top: number; bottom: number };
type DetailLayoutNode = {
  id: string;
  areaId: string;
  anchor: NodePosition;
  size: { width: number; height: number };
  preferredSide: DetailSide;
};
type DetailLayoutState = Record<string, Point2D>;
type OcdfgNodeSummary = { id: string; types?: string[]; role?: string | null; object_type?: string | null };
type ProcessAreaMetrics = {
  scale: number;
  objectNodeWidth: number;
  objectNodeMinHeight: number;
  gridColumnGap: number;
  gridRowGap: number;
  columnWidth: number;
  detailOffset: number;
  processAreaPaddingY: number;
  processAreaRadius: number;
  objectNodePaddingX: number;
  objectNodePaddingY: number;
  objectNodeRadius: number;
  objectNodeFontSize: number;
  objectEmptyFontSize: number;
  edgeStrokeScale: number;
  detailCollisionPadding: number;
  detailMinDistance: number;
};

const DEFAULT_BACKEND = 'http://127.0.0.1:8000';
const DEFAULT_PROCESS_AREA_SCALE = 0.9;
const MIN_PROCESS_AREA_SCALE = 0.4;
const MAX_PROCESS_AREA_SCALE = 1.2;
const PROCESS_AREA_SCALE_STEP = 0.02;
const ZOOM_IN_DURATION_MS = 260;
const ZOOM_OUT_DURATION_MS = 160;
const DETAIL_SCALE_PIVOT = 0.9;
const DETAIL_SCALE_BELOW_EXPONENT = 0.5;
const DETAIL_SCALE_ABOVE_EXPONENT = 1.4;
const BASE_OBJECT_NODE_WIDTH = 180;
const BASE_OBJECT_NODE_MIN_HEIGHT = 80;
const BASE_GRID_COLUMN_GAP = 24;
const BASE_GRID_ROW_GAP = 20;
const BASE_HORIZONTAL_PADDING = 32;
const BASE_PROCESS_AREA_PADDING_Y = 16;
const BASE_PROCESS_AREA_RADIUS = 28;
const BASE_OBJECT_NODE_PADDING_X = 20;
const BASE_OBJECT_NODE_PADDING_Y = 16;
const BASE_OBJECT_NODE_RADIUS = 18;
const BASE_OBJECT_NODE_FONT_SIZE = 18;
const BASE_OBJECT_EMPTY_FONT_SIZE = 15;
const PROCESS_AREA_BACKGROUND = 'rgba(59, 130, 246, 0.16)';
const PROCESS_AREA_BORDER = 'rgba(37, 99, 235, 0.35)';
const PROCESS_AREA_INSET_SHADOW = 'inset 0 0 0 1px rgba(37, 99, 235, 0.12)';
const DETAIL_EDGE_STROKE = 'rgba(37, 99, 235, 0.35)';
const BASE_DETAIL_COLLISION_PADDING = 12;
const DETAIL_ANCHOR_SPRING = 0.12;
const DETAIL_REPULSION = 0.38;
const DETAIL_OBSTACLE_PUSH = 0.55;
const DETAIL_DAMPING = 0.82;
const DETAIL_ITERATIONS = 60;
const BASE_DETAIL_MIN_DISTANCE = 24;
const LEVEL_LEGEND_GAP = 24;
const LEGEND_RIGHT_PADDING = 32;
const LEGEND_HIDE_INSET = 12; // pixels the intruder must cross into the legend before hiding
const CAMERA_PADDING = 24;

function buildProcessAreaMetrics(scale: number): ProcessAreaMetrics {
  const clamped = Math.min(MAX_PROCESS_AREA_SCALE, Math.max(MIN_PROCESS_AREA_SCALE, scale));
  const roundScaled = (value: number) => Math.max(1, Math.round(value * clamped));

  const objectNodeWidth = roundScaled(BASE_OBJECT_NODE_WIDTH);
  const objectNodeMinHeight = roundScaled(BASE_OBJECT_NODE_MIN_HEIGHT);
  const gridColumnGap = roundScaled(BASE_GRID_COLUMN_GAP);
  const gridRowGap = roundScaled(BASE_GRID_ROW_GAP);

  return {
    scale: clamped,
    objectNodeWidth,
    objectNodeMinHeight,
    gridColumnGap,
    gridRowGap,
    columnWidth: objectNodeWidth + gridColumnGap,
    detailOffset: gridColumnGap * 1.5,
    processAreaPaddingY: roundScaled(BASE_PROCESS_AREA_PADDING_Y),
    processAreaRadius: roundScaled(BASE_PROCESS_AREA_RADIUS),
    objectNodePaddingX: roundScaled(BASE_OBJECT_NODE_PADDING_X),
    objectNodePaddingY: roundScaled(BASE_OBJECT_NODE_PADDING_Y),
    objectNodeRadius: roundScaled(BASE_OBJECT_NODE_RADIUS),
    objectNodeFontSize: roundScaled(BASE_OBJECT_NODE_FONT_SIZE),
    objectEmptyFontSize: roundScaled(BASE_OBJECT_EMPTY_FONT_SIZE),
    edgeStrokeScale: clamped,
    detailCollisionPadding: roundScaled(BASE_DETAIL_COLLISION_PADDING),
    detailMinDistance: roundScaled(BASE_DETAIL_MIN_DISTANCE),
  };
}

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
  edgeScale,
  targetContact: _targetContact,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  pathLength: number;
  edgeScale: number;
  targetContact?: Point2D;
}): {
  bars: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  innerOffset: number | null;
} {
  const effectiveLength = Math.max(pathLength, 1);
  if (!Number.isFinite(effectiveLength) || effectiveLength <= 0) {
    return { bars: [], innerOffset: null };
  }

  const tolerance = 0.15 * edgeScale;
  const barHeight = Math.min(
    Math.max(10 * edgeScale, effectiveLength * 0.28),
    20 * edgeScale,
  );
  const halfPerp = barHeight;
  const perpX = -unitY;
  const perpY = unitX;
  const maxOffset = Math.max(0, effectiveLength - 0.75);
  const outerOffset = 0;
  const minGap = Math.max(
    6 * edgeScale,
    Math.min(18 * edgeScale, effectiveLength * 0.24),
  );
  const preferredGap = Math.max(
    minGap,
    Math.min(22 * edgeScale, effectiveLength * 0.28),
  );

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
  edgeScale,
}: {
  baseX: number;
  baseY: number;
  tipX: number;
  tipY: number;
  normalX: number;
  normalY: number;
  effectiveLength: number;
  edgeScale: number;
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
  const capWidth = Math.min(
    Math.max(10 * edgeScale, effectiveLength * 0.28),
    20 * edgeScale,
  );
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
  edgeScale = 1,
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

      const horizontalDirection = targetCenter.x >= sourceCenter.x ? 1 : -1;
      startPoint = {
        x: sourceCenter.x + (Math.max(source.width, 1) / 2) * horizontalDirection,
        y: clampedSourceY,
      };
      collisionPoint = {
        x: targetCenter.x - (Math.max(target.width, 1) / 2) * horizontalDirection,
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
      const rawCap = Math.min(
        Math.max(12 * edgeScale, toCollisionLength * 0.35),
        24 * edgeScale,
      );
      const maxAvailable = Math.max(toCollisionLength - 8 * edgeScale, 0);
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
      const maxApproach = Math.max(toCollisionLength - 4 * edgeScale, 0);
      const baseArrowLength = Math.min(
        Math.max(18, toCollisionLength * 0.45),
        maxApproach,
      );
      const arrowLength = Math.min(baseArrowLength * edgeScale, maxApproach);
      if (arrowLength > 8) {
        endX = collisionX - targetNormal.x * arrowLength;
        endY = collisionY - targetNormal.y * arrowLength;
        const arrowWidth = Math.min(
          Math.max(12 * edgeScale, arrowLength * 0.62),
          26 * edgeScale,
        );
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
        edgeScale,
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
        edgeScale,
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

function computeDetailSideByLevel(
  layers: ProcessLayer[],
  nodeColumns: Record<string, number>,
): Record<number, DetailSide> {
  const allColumns: number[] = [];
  const columnsByLevel = new Map<number, number[]>();

  layers.forEach((layer) => {
    const levelColumns: number[] = [];
    layer.areas.forEach((area) => {
      area.objectTypes.forEach((objectType) => {
        const column = nodeColumns[objectType];
        if (!Number.isFinite(column)) return;
        levelColumns.push(column);
        allColumns.push(column);
      });
    });
    columnsByLevel.set(layer.level, levelColumns);
  });

  const averageColumn =
    allColumns.length > 0
      ? allColumns.reduce((sum, value) => sum + value, 0) / allColumns.length
      : 0;
  const sortedLevels = Array.from(new Set(layers.map((layer) => layer.level))).sort(
    (a, b) => a - b,
  );
  const sideByLevel: Record<number, DetailSide> = {};
  let lastSide: DetailSide | null = null;
  const epsilon = 1e-3;

  sortedLevels.forEach((level) => {
    const columns = columnsByLevel.get(level) ?? [];
    let side: DetailSide = 'right';
    if (columns.length > 0) {
      const minColumn = Math.min(...columns);
      const maxColumn = Math.max(...columns);
      const leftDistance = averageColumn - minColumn;
      const rightDistance = maxColumn - averageColumn;
      if (leftDistance > rightDistance + epsilon) {
        side = 'left';
      } else if (rightDistance > leftDistance + epsilon) {
        side = 'right';
      } else if (lastSide) {
        side = lastSide === 'left' ? 'right' : 'left';
      }
    } else if (lastSide) {
      side = lastSide === 'left' ? 'right' : 'left';
    }
    sideByLevel[level] = side;
    lastSide = side;
  });

  return sideByLevel;
}

function detailRectFromCenter(
  center: Point2D,
  size: { width: number; height: number },
  id: string,
): Rect {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  return {
    id,
    left: center.x - halfWidth,
    right: center.x + halfWidth,
    top: center.y - halfHeight,
    bottom: center.y + halfHeight,
  };
}

function rectFromPosition(id: string, position?: NodePosition): Rect | null {
  if (!position) return null;
  return detailRectFromCenter(
    { x: position.centerX, y: position.centerY },
    { width: position.width, height: position.height },
    id,
  );
}

function rectsOverlap(a?: Rect | null, b?: Rect | null): boolean {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function insetRect(rect: Rect, inset: number): Rect | null {
  const left = rect.left + inset;
  const right = rect.right - inset;
  const top = rect.top + inset;
  const bottom = rect.bottom - inset;
  if (right <= left || bottom <= top) return null;
  return { id: rect.id, left, right, top, bottom };
}

function boundsApproximatelyEqual(
  a: { left: number; right: number; width: number } | null,
  b: { left: number; right: number; width: number } | null,
  tolerance = 0.5,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.right - b.right) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance
  );
}

function computeHorizontalBounds(
  positions: Record<string, NodePosition>,
  areaRects: Record<string, Rect>,
): { left: number; right: number; width: number } | null {
  let minLeft = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;

  Object.values(areaRects).forEach((rect) => {
    minLeft = Math.min(minLeft, rect.left);
    maxRight = Math.max(maxRight, rect.right);
  });

  Object.values(positions).forEach((pos) => {
    const left = pos.centerX - pos.width / 2;
    const right = pos.centerX + pos.width / 2;
    minLeft = Math.min(minLeft, left);
    maxRight = Math.max(maxRight, right);
  });

  if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight)) {
    return null;
  }

  return { left: minLeft, right: maxRight, width: Math.max(0, maxRight - minLeft) };
}

function computeVerticalBounds(
  positions: Record<string, NodePosition>,
  areaRects: Record<string, Rect>,
): { top: number; bottom: number; height: number } | null {
  let minTop = Number.POSITIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;

  Object.values(areaRects).forEach((rect) => {
    minTop = Math.min(minTop, rect.top);
    maxBottom = Math.max(maxBottom, rect.bottom);
  });

  Object.values(positions).forEach((pos) => {
    const top = pos.centerY - pos.height / 2;
    const bottom = pos.centerY + pos.height / 2;
    minTop = Math.min(minTop, top);
    maxBottom = Math.max(maxBottom, bottom);
  });

  if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom)) {
    return null;
  }

  return { top: minTop, bottom: maxBottom, height: Math.max(0, maxBottom - minTop) };
}

function layoutsApproximatelyEqual(
  a: DetailLayoutState,
  b: DetailLayoutState,
  tolerance = 0.05,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const pa = a[key];
    const pb = b[key];
    if (!pa || !pb) return false;
    return (
      Math.abs(pa.x - pb.x) <= tolerance &&
      Math.abs(pa.y - pb.y) <= tolerance
    );
  });
}

function legendOffsetsEqual(
  a: Record<number, number>,
  b: Record<number, number>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => {
    const numericKey = Number(key);
    return (a[numericKey] ?? 0) === (b[numericKey] ?? 0);
  });
}

function computeLegendOffsets(
  layers: ProcessLayer[],
  areaRects: Record<string, Rect>,
  detailNodes: DetailLayoutNode[],
  detailLayout: DetailLayoutState,
  _metrics: ProcessAreaMetrics,
  legendRects?: Record<number, Rect>,
): Record<number, number> {
  const detailByArea = new Map<string, DetailLayoutNode>();
  detailNodes.forEach((detail) => {
    detailByArea.set(detail.areaId, detail);
  });

  const offsets: Record<number, number> = {};

  layers.forEach((layer) => {
    const legendRect = legendRects?.[layer.level];
    const contractedLegend = legendRect ? insetRect(legendRect, LEGEND_HIDE_INSET) : null;

    if (!contractedLegend) {
      offsets[layer.level] = 0;
      return;
    }

    const areaOverlapsLegend = layer.areas.some((area) =>
      rectsOverlap(areaRects[area.id], contractedLegend),
    );

    const detailOverlapsLegend = layer.areas.some((area) => {
      const detail = detailByArea.get(area.id);
      const layoutPoint = detail ? detailLayout[area.id] : null;
      if (!detail || !layoutPoint) return false;
      const detailRect = detailRectFromCenter(
        { x: layoutPoint.x, y: layoutPoint.y },
        { width: detail.size.width, height: detail.size.height },
        detail.id,
      );
      return rectsOverlap(detailRect, contractedLegend);
    });

    offsets[layer.level] = areaOverlapsLegend || detailOverlapsLegend ? 1 : 0;
  });

  return offsets;
}

function computeDetailLayout(
  detailNodes: DetailLayoutNode[],
  processAreas: Rect[],
  previousLayout: DetailLayoutState,
  metrics: ProcessAreaMetrics,
  iterationScale = 1,
): DetailLayoutState {
  if (detailNodes.length === 0) return {};

  const nodes = detailNodes.map((detail) => {
    const preferredDirection = detail.preferredSide === 'left' ? -1 : 1;
    const baseDistance =
      detail.anchor.width / 2 + detail.size.width / 2 + metrics.detailOffset;
    const targetX =
      detail.anchor.centerX +
      preferredDirection * Math.max(baseDistance, metrics.detailMinDistance);
    const targetY = detail.anchor.centerY;
    const previous = previousLayout[detail.areaId];

    return {
      ...detail,
      x: Number.isFinite(previous?.x) ? previous!.x : targetX,
      y: Number.isFinite(previous?.y) ? previous!.y : targetY,
      targetX,
      targetY,
      vx: 0,
      vy: 0,
    };
  });

  const getRect = (node: typeof nodes[number]) =>
    detailRectFromCenter(
      { x: node.x, y: node.y },
      { width: node.size.width, height: node.size.height },
      node.id,
    );

  const totalIterations = Math.max(1, Math.round(DETAIL_ITERATIONS * iterationScale));

  for (let iteration = 0; iteration < totalIterations; iteration += 1) {
    nodes.forEach((node) => {
      node.vx = (node.vx + (node.targetX - node.x) * DETAIL_ANCHOR_SPRING) * DETAIL_DAMPING;
      node.vy = (node.vy + (node.targetY - node.y) * DETAIL_ANCHOR_SPRING) * DETAIL_DAMPING;
    });

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const minDx = (a.size.width + b.size.width) / 2 + metrics.detailCollisionPadding;
        const minDy = (a.size.height + b.size.height) / 2 + metrics.detailCollisionPadding;
        const overlapX = minDx - Math.abs(dx);
        const overlapY = minDy - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          const pushOnX = overlapX < overlapY;
          const pushAmount = Math.min(overlapX, overlapY) * DETAIL_REPULSION;
          if (pushOnX) {
            const dirX = dx >= 0 ? 1 : -1;
            a.vx += dirX * pushAmount;
            b.vx -= dirX * pushAmount;
          } else {
            const dirY = dy >= 0 ? 1 : -1;
            a.vy += dirY * pushAmount;
            b.vy -= dirY * pushAmount;
          }
        } else {
          const distance = Math.hypot(dx, dy);
          const desiredRange = Math.max(minDx, minDy) * 1.35;
          if (distance > 1e-3 && distance < desiredRange) {
            const softness =
              ((desiredRange - distance) / desiredRange) *
              DETAIL_REPULSION *
              0.45;
            const ux = dx / distance;
            const uy = dy / distance;
            a.vx += ux * softness;
            a.vy += uy * softness;
            b.vx -= ux * softness;
            b.vy -= uy * softness;
          }
        }
      }
    }

    nodes.forEach((node) => {
      const rect = getRect(node);
      processAreas.forEach((area) => {
        const expandedLeft = area.left - metrics.detailCollisionPadding;
        const expandedRight = area.right + metrics.detailCollisionPadding;
        const expandedTop = area.top - metrics.detailCollisionPadding;
        const expandedBottom = area.bottom + metrics.detailCollisionPadding;
        const overlapX = Math.min(rect.right, expandedRight) - Math.max(rect.left, expandedLeft);
        const overlapY = Math.min(rect.bottom, expandedBottom) - Math.max(rect.top, expandedTop);
        if (overlapX > 0 && overlapY > 0) {
          const areaCenterX = (area.left + area.right) / 2;
          const areaCenterY = (area.top + area.bottom) / 2;
          if (overlapX < overlapY) {
            const dir = node.x >= areaCenterX ? 1 : -1;
            node.vx += dir * overlapX * DETAIL_OBSTACLE_PUSH;
          } else {
            const dir = node.y >= areaCenterY ? 1 : -1;
            node.vy += dir * overlapY * DETAIL_OBSTACLE_PUSH;
          }
        }
      });

      node.x += node.vx;
      node.y += node.vy;

      if (!Number.isFinite(node.x)) node.x = node.targetX;
      if (!Number.isFinite(node.y)) node.y = node.targetY;

      const minX = node.size.width / 2 + metrics.detailMinDistance;
      const minY = node.size.height / 2 + metrics.detailMinDistance;
      node.x = Math.max(minX, node.x);
      node.y = Math.max(minY, node.y);
    });
  }

  // Final clean-up to make sure nothing overlaps after the simulation.
  const resolveRectangleOverlap = (
    rectA: Rect,
    rectB: Rect,
  ): { dx: number; dy: number } | null => {
    const overlapX = Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left);
    const overlapY = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
    if (overlapX > 0 && overlapY > 0) {
      if (overlapX < overlapY) {
        return { dx: overlapX * (rectA.left < rectB.left ? -0.5 : 0.5), dy: 0 };
      }
      return { dx: 0, dy: overlapY * (rectA.top < rectB.top ? -0.5 : 0.5) };
    }
    return null;
  };

  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      const rectA = getRect(a);
      processAreas.forEach((area) => {
        const overlap = resolveRectangleOverlap(rectA, {
          ...area,
          left: area.left - metrics.detailCollisionPadding,
          right: area.right + metrics.detailCollisionPadding,
          top: area.top - metrics.detailCollisionPadding,
          bottom: area.bottom + metrics.detailCollisionPadding,
        });
        if (overlap) {
          a.x += overlap.dx * 2;
          a.y += overlap.dy * 2;
        }
      });

      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        const rectB = getRect(b);
        const overlap = resolveRectangleOverlap(rectA, rectB);
        if (overlap) {
          a.x += overlap.dx;
          a.y += overlap.dy;
          b.x -= overlap.dx;
          b.y -= overlap.dy;
        }
      }
    }
  }

  const layout: DetailLayoutState = {};
  nodes.forEach((node) => {
    layout[node.areaId] = {
      x: Math.round(node.x * 100) / 100,
      y: Math.round(node.y * 100) / 100,
    };
  });

  return layout;
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
    const nodesAtLevel = nodesByLevel.get(level)?.slice().sort((a, b) => a.localeCompare(b)) ?? [];
    const seen = new Set<string>();
    let areaIndex = 0;

    nodesAtLevel.forEach((node) => {
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

    if (nodesAtLevel.length === 0 && !areas.some((area) => area.level === level)) {
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

function buildLayersFromBackend(data: TotemApiResponse): ProcessLayer[] {
  // Use pre-computed layers from the backend MLPA algorithm
  if (!data.layers || data.layers.length === 0) return [];

  // Sort layers by level descending (highest level first for display)
  const sortedApiLayers = [...data.layers].sort((a, b) => b.level - a.level);

  return sortedApiLayers.map((mlpaLayer) => ({
    level: mlpaLayer.level,
    areas: mlpaLayer.areas.map((mlpaArea, areaIndex) => ({
      id: `level-${mlpaLayer.level}-area-${areaIndex}-${mlpaArea.objectTypes.join('-')}`,
      level: mlpaLayer.level,
      label: mlpaArea.objectTypes.length === 1
        ? mlpaArea.objectTypes[0]
        : mlpaArea.objectTypes.join(' & '),
      objectTypes: mlpaArea.objectTypes,
    })),
  }));
}

function buildLayersFromFrontend(data: TotemApiResponse): ProcessLayer[] {
  // Use frontend's greedy MLPA-like algorithm
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

function buildLayers(data: TotemApiResponse, useBackendMlpa: boolean): ProcessLayer[] {
  if (useBackendMlpa && data.layers && data.layers.length > 0) {
    return buildLayersFromBackend(data);
  }
  return buildLayersFromFrontend(data);
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
  reloadSignal,
  title,
  topInset = 0,
}: TotemVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTotem, setRawTotem] = useState<TotemApiResponse | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const legendRefs = useRef<Record<number, HTMLElement | null>>({});
  const areaRectsRef = useRef<Record<string, Rect>>({});
  const [edgeSegments, setEdgeSegments] = useState<EdgeSegment[]>([]);
  const [contentSize, setContentSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const resetScrollToCenter = useCallback(() => {
    const container = scrollContainerRef.current;
    const contentEl = contentRef.current;
    if (!container || !contentEl) return;
    const targetLeft = Math.max(0, (contentEl.scrollWidth - container.clientWidth) / 2);
    const targetTop = Math.max(0, (contentEl.scrollHeight - container.clientHeight) / 2);
    container.scrollTo({ left: targetLeft, top: targetTop });
  }, []);
  const centerCamera = useCallback(
    (
      hBounds: { left: number; right: number; width: number },
      vBounds: { top: number; bottom: number; height: number },
    ) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const centerX = (hBounds.left + hBounds.right) / 2;
      const centerY = (vBounds.top + vBounds.bottom) / 2;
      const targetLeft = Math.max(
        0,
        centerX - container.clientWidth / 2 - CAMERA_PADDING,
      );
      const targetTop = Math.max(
        0,
        centerY - container.clientHeight / 2 - CAMERA_PADDING,
      );

      const maxLeft = Math.max(0, (contentRef.current?.scrollWidth ?? 0) - container.clientWidth);
      const maxTop = Math.max(0, (contentRef.current?.scrollHeight ?? 0) - container.clientHeight);

      container.scrollTo({
        left: Math.min(targetLeft, maxLeft),
        top: Math.min(targetTop, maxTop),
        behavior: 'smooth',
      });
    },
    [],
  );

  const assignNodeRef = useCallback((type: string, element: HTMLElement | null) => {
    if (element) {
      nodeRefs.current[type] = element;
    } else {
      delete nodeRefs.current[type];
    }
  }, []);

  const assignLegendRef = useCallback((level: number, element: HTMLElement | null) => {
    if (element) {
      legendRefs.current[level] = element;
    } else {
      delete legendRefs.current[level];
    }
  }, []);
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});
  const [detailSizes, setDetailSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [detailLayout, setDetailLayout] = useState<DetailLayoutState>({});
  const [detailCache, setDetailCache] = useState<Record<string, OcdfgGraph>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailError, setDetailError] = useState<Record<string, string | undefined>>({});
  const [allOcdfgNodes, setAllOcdfgNodes] = useState<OcdfgNodeSummary[] | null>(null);
  const [legendOffsets, setLegendOffsets] = useState<Record<number, number>>({});
  const [processAreaScale, setProcessAreaScale] = useState(DEFAULT_PROCESS_AREA_SCALE);
  const [smoothedProcessAreaScale, setSmoothedProcessAreaScale] = useState(DEFAULT_PROCESS_AREA_SCALE);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [useMockData, setUseMockData] = useState(true);
  const [useBackendMlpa, setUseBackendMlpa] = useState(true);
  const [layoutBounds, setLayoutBounds] = useState<{ left: number; right: number; width: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [autoZoomTrigger, setAutoZoomTrigger] = useState(0);
  const layoutBoundsRef = useRef<typeof layoutBounds>(null);
  const viewportWidthRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const lastAppliedAutoZoomRef = useRef(0);
  const [verticalBounds, setVerticalBounds] = useState<{ top: number; bottom: number; height: number } | null>(null);
  const verticalBoundsRef = useRef<typeof verticalBounds>(null);
  const lastCenteredTriggerRef = useRef(0);
  const [pendingCenter, setPendingCenter] = useState(0);
  const smoothedProcessAreaScaleRef = useRef(DEFAULT_PROCESS_AREA_SCALE);
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const zoomAnimationStateRef = useRef<{
    from: number;
    to: number;
    start: number;
    duration: number;
  } | null>(null);

  const handleProcessAreaScaleChange = useCallback((nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    const clamped = Math.min(MAX_PROCESS_AREA_SCALE, Math.max(MIN_PROCESS_AREA_SCALE, nextValue));
    setProcessAreaScale(clamped);
  }, []);

  useEffect(() => {
    smoothedProcessAreaScaleRef.current = smoothedProcessAreaScale;
  }, [smoothedProcessAreaScale]);

  useEffect(() => {
    if (zoomAnimationFrameRef.current !== null) {
      cancelAnimationFrame(zoomAnimationFrameRef.current);
      zoomAnimationFrameRef.current = null;
    }

    const from = smoothedProcessAreaScaleRef.current;
    const to = processAreaScale;
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      setSmoothedProcessAreaScale(to);
      smoothedProcessAreaScaleRef.current = to;
      return;
    }

    const duration = to > from ? ZOOM_IN_DURATION_MS : ZOOM_OUT_DURATION_MS;
    const start = performance.now();
    zoomAnimationStateRef.current = { from, to, start, duration };

    const step = (now: number) => {
      const state = zoomAnimationStateRef.current;
      if (!state) return;
      const t = Math.min(1, (now - state.start) / Math.max(state.duration, 1));
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const next = state.from + (state.to - state.from) * eased;
      setSmoothedProcessAreaScale(next);
      smoothedProcessAreaScaleRef.current = next;
      if (t < 1) {
        zoomAnimationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        zoomAnimationFrameRef.current = null;
        zoomAnimationStateRef.current = null;
        setSmoothedProcessAreaScale(state.to);
        smoothedProcessAreaScaleRef.current = state.to;
      }
    };

    zoomAnimationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (zoomAnimationFrameRef.current !== null) {
        cancelAnimationFrame(zoomAnimationFrameRef.current);
        zoomAnimationFrameRef.current = null;
      }
    };
  }, [processAreaScale]);

  const processAreaMetrics = useMemo(
    () => buildProcessAreaMetrics(smoothedProcessAreaScale),
    [smoothedProcessAreaScale],
  );
  const detailScale = useMemo(() => {
    const scale = processAreaMetrics.scale;
    if (!Number.isFinite(scale)) return DETAIL_SCALE_PIVOT;
    if (scale <= DETAIL_SCALE_PIVOT) {
      const ratio = Math.max(0, scale / DETAIL_SCALE_PIVOT);
      return DETAIL_SCALE_PIVOT * Math.pow(ratio, DETAIL_SCALE_BELOW_EXPONENT);
    }
    const upperSpan = MAX_PROCESS_AREA_SCALE - DETAIL_SCALE_PIVOT;
    if (upperSpan <= 0) return scale;
    const ratio = Math.min(1, Math.max(0, (scale - DETAIL_SCALE_PIVOT) / upperSpan));
    return DETAIL_SCALE_PIVOT + upperSpan * Math.pow(ratio, DETAIL_SCALE_ABOVE_EXPONENT);
  }, [processAreaMetrics.scale]);
  const horizontalPadding = Math.round(BASE_HORIZONTAL_PADDING * processAreaMetrics.scale);
  const resolvedTopInset = Math.max(0, topInset ?? 0);
  const contentPaddingTop = 32 + resolvedTopInset;
  const computedHeight = resolveHeight(height);
  const {
    objectNodeWidth,
    objectNodeMinHeight,
    gridColumnGap,
    gridRowGap,
    columnWidth,
    detailOffset,
    processAreaPaddingY,
    processAreaRadius,
    objectNodePaddingX,
    objectNodePaddingY,
    objectNodeRadius,
    objectNodeFontSize,
    objectEmptyFontSize,
    edgeStrokeScale,
  } = processAreaMetrics;

  const layers = useMemo(() => (rawTotem ? buildLayers(rawTotem, useBackendMlpa) : []), [rawTotem, useBackendMlpa]);
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
  const levelGridTemplate = `repeat(${totalColumns}, ${columnWidth}px)`;
  const levelMinimumWidth = totalColumns * columnWidth;
  const areaPlacements = layoutInfo.areaPlacements;
  const nodeColumns = layoutInfo.nodeColumns;
  const detailSideByLevel = useMemo(
    () => computeDetailSideByLevel(layers, nodeColumns),
    [layers, nodeColumns],
  );
  const contentPaddingLeft = useMemo(() => {
    let requiredPadding = horizontalPadding;

    layers.forEach((layer) => {
      const side = detailSideByLevel[layer.level] ?? 'right';
      if (side !== 'left') return;
      layer.areas.forEach((area) => {
        if (!expandedAreas[area.id]) return;
        const baseDetailWidth = detailSizes[area.id]?.width ?? BASE_OBJECT_NODE_WIDTH;
        const detailWidth = baseDetailWidth * detailScale;
        const startColumn = areaPlacements[area.id]?.startColumn ?? 0;
        const neededPadding = detailOffset + detailWidth - startColumn * columnWidth;
        if (neededPadding > requiredPadding) {
          requiredPadding = neededPadding;
        }
      });
    });

    return Math.max(horizontalPadding, requiredPadding);
  }, [
    layers,
    detailSideByLevel,
    expandedAreas,
    detailSizes,
    areaPlacements,
    detailOffset,
    objectNodeWidth,
    columnWidth,
    horizontalPadding,
    detailScale,
  ]);
  const detailEdgeSegments = useMemo(
    () => edgeSegments.filter((segment) => segment.relation === 'A'),
    [edgeSegments],
  );
  const primaryEdgeSegments = useMemo(
    () => edgeSegments.filter((segment) => segment.relation !== 'A'),
    [edgeSegments],
  );
  const legendColumnOffset = useMemo(() => {
    const offsets = Object.values(legendOffsets);
    if (offsets.length === 0) return 0;
    const needsHide = offsets.some((value) => (value ?? 0) > 0.5);
    if (needsHide) return 0;
    return Math.max(0, ...offsets.filter((value) => Number.isFinite(value)));
  }, [legendOffsets]);
  const legendHidden = useMemo(
    () => Object.values(legendOffsets).some((value) => (value ?? 0) > 0.5),
    [legendOffsets],
  );
  const hasLayers = layers.length > 0;
  const fetchTotem = useCallback(async () => {
    if (!eventLogId) {
      setRawTotem(null);
      return;
    }

    // Use mock data if toggle is enabled
    if (useMockData) {
      setRawTotem(TOTEM_MOCK);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    // Clear stale mock data so the legend/process areas reflect the new backend result as soon as it arrives
    setRawTotem(null);
    try {
      const token = localStorage.getItem('access_token');
      // Choose endpoint based on MLPA toggle
      const endpoint = useBackendMlpa
        ? `${backendBaseUrl}/api/files/${eventLogId}/discover_mlpa/`
        : `${backendBaseUrl}/api/files/${eventLogId}/discover_totem/`;
      const response = await fetch(
        endpoint,
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
  }, [backendBaseUrl, eventLogId, useMockData, useBackendMlpa]);

  const fetchDetailOcdfg = useCallback(
    async (area: ProcessAreaDefinition) => {
      const areaId = area.id;

      if (!eventLogId) {
        setDetailError((prev) => ({
          ...prev,
          [areaId]: 'No event log selected',
        }));
        return;
      }

      // Mock mode stays on existing behaviour
      if (useMockData) {
        setDetailCache((prev) => ({
          ...prev,
          [areaId]: selectDetailMock(area),
        }));
        return;
      }

      // Avoid duplicate requests
      setDetailLoading((prev) => {
        if (prev[areaId]) return prev;
        return { ...prev, [areaId]: true };
      });
      setDetailError((prev) => ({ ...prev, [areaId]: undefined }));

      try {
        const token = localStorage.getItem('access_token');
        const objectTypes = encodeURIComponent(area.objectTypes.join(','));
        const response = await fetch(
          `${backendBaseUrl}/api/ocdfg/?file_id=${eventLogId}&object_types=${objectTypes}`,
          {
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );

        const payload: { dfg?: OcdfgGraph; all_nodes?: OcdfgNodeSummary[]; filter_error?: string } & Partial<OcdfgGraph> =
          await response.json();
        if (!response.ok) {
          const errMsg = payload?.filter_error || payload?.error || `Backend responded with ${response.status}`;
          throw new Error(errMsg);
        }
        const graph = payload?.dfg ?? { nodes: (payload as any)?.nodes, links: (payload as any)?.links };
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
          throw new Error('Invalid OCDFG payload');
        }

        if (Array.isArray(payload?.all_nodes) && payload.all_nodes.length > 0) {
          setAllOcdfgNodes((prev) => prev ?? payload.all_nodes);
        }

        setDetailCache((prev) => ({
          ...prev,
          [areaId]: graph as OcdfgGraph,
        }));
        if (payload?.filter_error) {
          setDetailError((prev) => ({ ...prev, [areaId]: payload.filter_error }));
        }
      } catch (err) {
        console.error('[TotemVisualizer] Failed to load detail OCDFG', err);
        setDetailError((prev) => ({
          ...prev,
          [areaId]: err instanceof Error ? err.message : 'Failed to load OCDFG',
        }));
      } finally {
        setDetailLoading((prev) => {
          const { [areaId]: _removed, ...rest } = prev;
          return rest;
        });
      }
    },
    [backendBaseUrl, eventLogId, useMockData],
  );

  const toggleAreaDetail = useCallback(
    (area: ProcessAreaDefinition) => {
      setExpandedAreas((prev) => {
        const alreadyOpen = prev[area.id];
        if (alreadyOpen) {
          const { [area.id]: _removed, ...rest } = prev;
          return rest;
        }
        // Kick off detail fetch on first open
        if (!detailCache[area.id] && !detailLoading[area.id]) {
          fetchDetailOcdfg(area);
        }
        return { ...prev, [area.id]: true };
      });
    },
    [detailCache, detailLoading, fetchDetailOcdfg],
  );

  useEffect(() => {
    fetchTotem();
  }, [fetchTotem, reloadSignal, useMockData, useBackendMlpa]);

  useEffect(() => {
    setPendingCenter((value) => value + 1);
    setProcessAreaScale(DEFAULT_PROCESS_AREA_SCALE);
    setSmoothedProcessAreaScale(DEFAULT_PROCESS_AREA_SCALE);
  }, [reloadSignal]);

  useEffect(() => {
    setExpandedAreas({});
    setDetailSizes({});
    setDetailLayout({});
    setDetailCache({});
    setDetailLoading({});
    setDetailError({});
    setAllOcdfgNodes(null);
    setLegendOffsets({});
    setProcessAreaScale(DEFAULT_PROCESS_AREA_SCALE);
    setSmoothedProcessAreaScale(DEFAULT_PROCESS_AREA_SCALE);
    setPendingCenter((value) => value + 1);
  }, [rawTotem?.tempgraph]);

  useEffect(() => {
    setDetailCache({});
    setDetailLoading({});
    setDetailError({});
    setAllOcdfgNodes(null);
  }, [eventLogId, useMockData, useBackendMlpa]);

  // Also reset layout/legend when switching between mock data and backend variants
  useEffect(() => {
    setExpandedAreas({});
    setDetailSizes({});
    setDetailLayout({});
    setLegendOffsets({});
    setPendingCenter((value) => value + 1);
  }, [useMockData, useBackendMlpa]);

  useEffect(() => {
    if (pendingCenter === 0) return;
    if (!hasLayers) return;
    resetScrollToCenter();
    setPendingCenter(0);
  }, [pendingCenter, hasLayers, contentSize.width, contentSize.height, resetScrollToCenter]);

  useEffect(() => {
    if (!autoZoomEnabled) return;
    if (autoZoomTrigger === 0) return;
    if (autoZoomTrigger === lastAppliedAutoZoomRef.current) return;
    if (!layoutBounds) return;
    if (!verticalBounds) return;
    if (viewportWidth <= 0) return;
    if (viewportHeight <= 0) return;
    const currentScale = smoothedProcessAreaScale;
    if (currentScale <= 0) return;

    const safetyPadding = Math.max(horizontalPadding * 2, 48);
    const availableWidth = Math.max(0, viewportWidth - safetyPadding);
    const verticalPaddingAllowance = contentPaddingTop + 72; // matches paddingTop + paddingBottom
    const availableHeight = Math.max(0, viewportHeight - verticalPaddingAllowance);
    if (availableWidth <= 0 || availableHeight <= 0 || layoutBounds.width <= 0 || verticalBounds.height <= 0) return;

    const ratioX = availableWidth / layoutBounds.width;
    const ratioY = availableHeight / verticalBounds.height;
    const ratio = Math.min(ratioX, ratioY);
    const tolerance = 0.02; // deadzone to avoid jitter
    if (ratio > 1 - tolerance && ratio < 1 + tolerance) {
      // Scale is already acceptable; just center.
      lastAppliedAutoZoomRef.current = autoZoomTrigger;
      if (lastCenteredTriggerRef.current !== autoZoomTrigger) {
        centerCamera(layoutBounds, verticalBounds);
        lastCenteredTriggerRef.current = autoZoomTrigger;
      }
      return;
    }

    const targetScale = Math.min(
      MAX_PROCESS_AREA_SCALE,
      Math.max(MIN_PROCESS_AREA_SCALE, currentScale * ratio),
    );

    if (Math.abs(targetScale - processAreaScale) >= 0.003) {
      handleProcessAreaScaleChange(targetScale);
    }

    lastAppliedAutoZoomRef.current = autoZoomTrigger;
    if (lastCenteredTriggerRef.current !== autoZoomTrigger) {
      centerCamera(layoutBounds, verticalBounds);
      lastCenteredTriggerRef.current = autoZoomTrigger;
    }
  }, [
    autoZoomEnabled,
    autoZoomTrigger,
    centerCamera,
    handleProcessAreaScaleChange,
    horizontalPadding,
    layoutBounds,
    contentPaddingTop,
    processAreaScale,
    smoothedProcessAreaScale,
    viewportWidth,
    viewportHeight,
    verticalBounds,
  ]);

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
        const isZooming = Boolean(zoomAnimationStateRef.current);
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

        const legendRects: Record<number, Rect> = {};
        Object.entries(legendRefs.current).forEach(([levelKey, element]) => {
          if (!element) return;
          const rect = element.getBoundingClientRect();
          const level = Number(levelKey);
          legendRects[level] = {
            id: `legend-${level}`,
            left: rect.left - contentRect.left,
            right: rect.right - contentRect.left,
            top: rect.top - contentRect.top,
            bottom: rect.bottom - contentRect.top,
          };
        });

        const areaRects: Record<string, Rect> = {};
        const detailNodes: DetailLayoutNode[] = [];

        layers.forEach((layer) => {
          layer.areas.forEach((area) => {
            const anchorId = `${area.id}::anchor`;
            const anchorPosition = positions[anchorId];
            const areaRect = rectFromPosition(area.id, anchorPosition);
            if (areaRect) {
              areaRects[area.id] = areaRect;
            }

            if (!expandedAreas[area.id] || !anchorPosition) return;
            const baseSize = detailSizes[area.id] ?? {
              width: BASE_OBJECT_NODE_WIDTH,
              height: BASE_OBJECT_NODE_MIN_HEIGHT,
            };
            const size = {
              width: baseSize.width * detailScale,
              height: baseSize.height * detailScale,
            };
            detailNodes.push({
              id: `${area.id}::detail`,
              areaId: area.id,
              anchor: anchorPosition,
              size,
              preferredSide: detailSideByLevel[area.level] ?? 'right',
            });
          });
        });

        areaRectsRef.current = areaRects;

        const computedLayout = computeDetailLayout(
          detailNodes,
          Object.values(areaRects),
          isZooming ? {} : detailLayout,
          processAreaMetrics,
          isZooming ? 2.5 : 1,
        );

        if (isZooming || !layoutsApproximatelyEqual(detailLayout, computedLayout)) {
          setDetailLayout(computedLayout);
        }

        const computedLegendOffsets = computeLegendOffsets(
          layers,
          areaRects,
          detailNodes,
          computedLayout,
          processAreaMetrics,
          legendRects,
        );
        if (!legendOffsetsEqual(legendOffsets, computedLegendOffsets)) {
          setLegendOffsets(computedLegendOffsets);
        }

        const mergedPositions: Record<string, NodePosition> = { ...positions };

        detailNodes.forEach((detail) => {
          const layoutPoint = computedLayout[detail.areaId];
          if (!layoutPoint) return;
          mergedPositions[detail.id] = {
            centerX: layoutPoint.x,
            centerY: layoutPoint.y,
            width: detail.size.width,
            height: detail.size.height,
          };
        });

        const segments = computeEdgeSegments(
          allEdges,
          mergedPositions,
          areaAnchorMembers,
          edgeStrokeScale,
        );
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

        const baseBounds = computeHorizontalBounds(mergedPositions, areaRects);
        const bounds = baseBounds;
        const boundsChanged = !boundsApproximatelyEqual(layoutBoundsRef.current, bounds);
        if (boundsChanged) {
          layoutBoundsRef.current = bounds;
          setLayoutBounds(bounds);
          setAutoZoomTrigger((value) => value + 1);
        }

        const vBounds = computeVerticalBounds(mergedPositions, areaRects);
        const vChanged =
          !vBounds ||
          !verticalBoundsRef.current ||
          Math.abs((verticalBoundsRef.current?.top ?? 0) - (vBounds?.top ?? 0)) > 0.5 ||
          Math.abs((verticalBoundsRef.current?.bottom ?? 0) - (vBounds?.bottom ?? 0)) > 0.5;
        if (vChanged) {
          verticalBoundsRef.current = vBounds;
          setVerticalBounds(vBounds);
          setAutoZoomTrigger((value) => value + 1);
        }

        const containerWidth = scrollContainerRef.current?.clientWidth ?? 0;
        const widthChanged = Math.abs((viewportWidthRef.current ?? 0) - containerWidth) > 0.5;
        if (widthChanged && Number.isFinite(containerWidth)) {
          viewportWidthRef.current = containerWidth;
          setViewportWidth(containerWidth);
          setAutoZoomTrigger((value) => value + 1);
        }

        const containerHeight = scrollContainerRef.current?.clientHeight ?? 0;
        const heightChanged = Math.abs((viewportHeightRef.current ?? 0) - containerHeight) > 0.5;
        if (heightChanged && Number.isFinite(containerHeight)) {
          viewportHeightRef.current = containerHeight;
          setViewportHeight(containerHeight);
          setAutoZoomTrigger((value) => value + 1);
        }
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
  }, [
    allEdges,
    areaAnchorMembers,
    detailLayout,
    detailSideByLevel,
    detailSizes,
    expandedAreas,
    legendOffsets,
    layers,
    processAreaMetrics,
    rawTotem,
  ]);

  return (
    <div className="relative flex-1" style={{ height: computedHeight, width: '100%' }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 9999,
          border: '1px solid #E2E8F0',
          background: '#FFFFFF',
          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
        }}
      >
        <Slider
          min={MIN_PROCESS_AREA_SCALE}
          max={MAX_PROCESS_AREA_SCALE}
          step={PROCESS_AREA_SCALE_STEP}
          value={[processAreaScale]}
          onValueChange={(values) => handleProcessAreaScaleChange(values?.[0] ?? DEFAULT_PROCESS_AREA_SCALE)}
          style={{ width: 120 }}
        />
        <Button
          type="button"
          variant={autoZoomEnabled ? 'secondary' : 'outline'}
          size="icon"
          onClick={() => {
            const next = !autoZoomEnabled;
            setAutoZoomEnabled(next);
            if (next) {
              setAutoZoomTrigger((value) => value + 1);
            }
          }}
          className="rounded-full h-9 w-9"
          title={autoZoomEnabled ? 'Disable auto-zoom' : 'Enable auto-zoom'}
        >
          <ScanIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={useMockData ? 'secondary' : 'outline'}
          size="icon"
          onClick={() => setUseMockData((prev) => !prev)}
          className="rounded-full h-9 w-9"
          title={useMockData ? 'Use backend data' : 'Use mock data'}
        >
          <FlaskConicalIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={useBackendMlpa ? 'secondary' : 'outline'}
          size="icon"
          onClick={() => setUseBackendMlpa((prev) => !prev)}
          className="rounded-full h-9 w-9"
          title={useBackendMlpa ? 'Using backend MLPA (ILP)' : 'Using frontend MLPA (greedy)'}
        >
          <BrainIcon className="h-4 w-4" />
        </Button>
      </div>
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
            paddingTop: contentPaddingTop,
            paddingRight: horizontalPadding,
            paddingBottom: 72,
            paddingLeft: contentPaddingLeft,
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
                    (edge.relation === 'D'
                      ? 3.2
                      : edge.relation === 'P'
                        ? 3
                        : edge.relation === 'A'
                          ? 2.2
                          : 2.6) * edgeStrokeScale;
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
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: levelGridTemplate,
                          columnGap: 0,
                          rowGap: gridRowGap,
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
                          const templateColumns = `repeat(${spanColumns}, ${objectNodeWidth}px)`;
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
                          const baseDetailWidth = detailSize?.width ?? BASE_OBJECT_NODE_WIDTH;
                          const baseDetailHeight = detailSize?.height ?? BASE_OBJECT_NODE_MIN_HEIGHT;
                          const ocdfgWidth = baseDetailWidth * detailScale;
                          const ocdfgHeight = baseDetailHeight * detailScale;
                          const cachedDetail = detailCache[area.id];
                          const loadingDetail = Boolean(detailLoading[area.id]);
                          const errorDetail = detailError[area.id];
                          const detailData = useMockData ? selectDetailMock(area) : cachedDetail;
                          const detailSide = detailSideByLevel[area.level] ?? 'right';
                          const detailCenter = detailLayout[area.id];
                          const areaRect = areaRectsRef.current[area.id];
                          const layoutLeft =
                            detailCenter && areaRect
                              ? detailCenter.x - areaRect.left - ocdfgWidth / 2
                              : null;
                          const layoutTop =
                            detailCenter && areaRect
                              ? detailCenter.y - areaRect.top - ocdfgHeight / 2
                              : null;
                          const fallbackPosition =
                            detailSide === 'left'
                              ? { right: `calc(100% + ${detailOffset}px)` }
                              : { left: `calc(100% + ${detailOffset}px)` };
                          const detailPosition =
                            layoutLeft !== null && layoutTop !== null
                              ? { left: layoutLeft, top: layoutTop, transform: 'none' as const }
                              : { top: '50%', transform: 'translateY(-50%)', ...fallbackPosition };
                          const containerMinHeight =
                            objectNodeMinHeight + processAreaPaddingY * 2;

                          return (
                            <div
                              key={area.id}
                              style={{
                                gridColumn: `${startColumn + 1} / span ${spanColumns}`,
                                padding: `${processAreaPaddingY}px ${gridColumnGap / 2}px`,
                                display: 'grid',
                                gridTemplateColumns: templateColumns,
                                columnGap: gridColumnGap,
                                rowGap: gridRowGap,
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
                                  borderRadius: processAreaRadius,
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
                                onClick={() => toggleAreaDetail(area)}
                                aria-pressed={isExpanded}
                                aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${area.label}`}
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  borderRadius: processAreaRadius,
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
                                        padding: `${objectNodePaddingY}px ${objectNodePaddingX}px`,
                                        borderRadius: objectNodeRadius,
                                        fontSize: objectNodeFontSize,
                                        fontWeight: 600,
                                        color: readableColor,
                                        background: baseColor,
                                        border: `1px solid ${lighten(baseColor, 0.35)}`,
                                        lineHeight: 1.15,
                                        width: objectNodeWidth,
                                        minHeight: objectNodeMinHeight,
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
                                    fontSize: objectEmptyFontSize,
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
                                    ...detailPosition,
                                    width: ocdfgWidth,
                                    minWidth: ocdfgWidth,
                                    minHeight: ocdfgHeight,
                                    height: ocdfgHeight,
                                    borderRadius: objectNodeRadius,
                                    border: `1.5px solid ${detailBorder}`,
                                    background: 'transparent',
                                    display: 'flex',
                                    alignItems: 'stretch',
                                    justifyContent: 'center',
                                    zIndex: 1,
                                    boxSizing: 'border-box',
                                    boxShadow: 'inset 0 0 12px 3px rgba(37, 99, 235, 0.08)',
                                    color: detailForeground,
                                    pointerEvents: 'auto',
                                    overflow: 'hidden',
                                    transition:
                                      'width 220ms ease, height 220ms ease, left 220ms ease, top 220ms ease, right 220ms ease, transform 220ms ease',
                                    willChange: 'width, height, left, top, right, transform',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: ocdfgWidth,
                                      height: ocdfgHeight,
                                      transform: 'none',
                                      transformOrigin: 'top left',
                                      transition: 'width 220ms ease, height 220ms ease',
                                      willChange: 'width, height',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      pointerEvents: 'auto',
                                    }}
                                  >
                                    {useMockData ? (
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
                                    ) : loadingDetail ? (
                                      <div
                                        style={{
                                          fontSize: 12,
                                          color: '#475569',
                                          padding: '8px 10px',
                                          textAlign: 'center',
                                        }}
                                      >
                                        Loading OCDFG…
                                      </div>
                                    ) : errorDetail ? (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6,
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          textAlign: 'center',
                                          padding: '8px 10px',
                                          fontSize: 12,
                                          color: '#B91C1C',
                                        }}
                                      >
                                        <span>{errorDetail}</span>
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onClick={() => fetchDetailOcdfg(area)}
                                          style={{ pointerEvents: 'auto' }}
                                        >
                                          Retry
                                        </Button>
                                      </div>
                                    ) : detailData ? (
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
                                    ) : (
                                      <div
                                        style={{
                                          fontSize: 12,
                                          color: '#475569',
                                          padding: '8px 10px',
                                          textAlign: 'center',
                                        }}
                                      >
                                        Tap to load OCDFG
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <header
                        ref={(element) => assignLegendRef(layer.level, element)}
                        aria-hidden={legendHidden}
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          gap: 3,
                          color: '#0F172A',
                          minWidth: 120,
                          paddingRight: LEGEND_RIGHT_PADDING,
                          opacity: legendHidden ? 0 : 1,
                          visibility: legendHidden ? 'hidden' : 'visible',
                          pointerEvents: legendHidden ? 'none' : 'auto',
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
