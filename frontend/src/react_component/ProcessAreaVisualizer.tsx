import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { ScanIcon, RefreshCcw } from 'lucide-react';
import { mapTypesToColors, textColorForBackground } from '../utils/objectColors';
import OCDFGDetailVisualizer from './OCDFGDetailVisualizer';
import type { OcdfgGraph } from './OCDFGVisualizer';

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

export type ProcessAreaVisualizerControls = {
  processAreaScale: number;
  onProcessAreaScaleChange: (value: number) => void;
  autoZoomEnabled: boolean;
  onAutoZoomToggle: () => void;
  minScale: number;
  maxScale: number;
  scaleStep: number;
};

type ProcessAreaVisualizerProps = {
  eventLogId?: number | string | null;
  height?: string | number;
  backendBaseUrl?: string;
  reloadSignal?: number;
  title?: string;
  topInset?: number;
  /** When true, renders only the canvas (no surrounding card/controls). Mirrors VariantsExplorer embedded prop. */
  embedded?: boolean;
  onControlsReady?: (controls: ProcessAreaVisualizerControls) => void;
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
  debugWaypoints?: Array<{ x: number; y: number }>; // For debugging
  crossesNode?: boolean;
  crossingPoints?: Array<{ x: number; y: number }>;
  renderStart?: Point2D;
  renderEnd?: Point2D;
};

type Point2D = { x: number; y: number };

type NodeSide = 'top' | 'bottom' | 'left' | 'right';

// Softer, sweeping corners for S/Z-shaped postprocessed edges only
const FLOWING_S_CURVE = {
  cornerScale: 1.15,
  maxCornerRadius: 290,
  minCornerRadius: 18,
};

// Discrete attachment slots for each side
type HorizontalSlot = 'left' | 'center' | 'right'; // For top/bottom sides (3 positions)
type VerticalSlot = 'top' | 'center' | 'bottom'; // For left/right sides (3 positions, center used for single edge)

type AttachmentSlot = {
  side: NodeSide;
  slot: HorizontalSlot | VerticalSlot;
};

// Slot positions as fractions of the node dimension
const HORIZONTAL_SLOT_POSITIONS: Record<HorizontalSlot, number> = {
  left: -0.3, // 30% left of center
  center: 0, // center
  right: 0.3, // 30% right of center
};

const VERTICAL_SLOT_POSITIONS: Record<VerticalSlot, number> = {
  top: -0.3, // 30% above center
  center: 0, // center (used when only 1 edge)
  bottom: 0.3, // 30% below center
};

// Priority for edge ordering when spreading attachments: P gets center, then D, I, A
const RELATION_PRIORITY: Record<RelationType, number> = {
  P: 0,
  D: 1,
  I: 2,
  A: 3,
};

type AttachmentInfo = {
  edge: EdgeDescriptor;
  side: NodeSide;
};

type AttachmentTracker = {
  // Map from "nodeId-side" to list of edges attaching there
  targetAttachments: Map<string, EdgeDescriptor[]>;
  sourceAttachments: Map<string, EdgeDescriptor[]>; // Only 'P' edges tracked here
  // Combined map: ALL edges (both incoming and outgoing) per node-side
  // Used for port assignment so incoming/outgoing edges don't share same port
  allAttachments: Map<string, EdgeDescriptor[]>;
};

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

// Spatial index types for obstacle-aware edge routing
type ObstacleRect = { left: number; top: number; right: number; bottom: number };
type Obstacle = { id: string; rect: ObstacleRect; type: 'node' | 'area' };
type SpatialIndex = {
  obstacles: Obstacle[];
  nodeObstacles: Obstacle[];
  areaObstacles: Obstacle[];
};

// Route candidate for multi-option routing
type RouteCandidate = {
  waypoints: Point2D[];
  sourceExit: NodeSide;
  targetEntry: NodeSide;
  score: number;
};

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
const MIN_PROCESS_AREA_SCALE = 0.2;
const MAX_PROCESS_AREA_SCALE = 1.2;
const PROCESS_AREA_SCALE_STEP = 0.02;
const ZOOM_IN_DURATION_MS = 260;
const ZOOM_OUT_DURATION_MS = 160;
const DETAIL_SCALE_PIVOT = 0.85;
const DETAIL_SCALE_BELOW_EXPONENT = 0.45;
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
const DETAIL_REPULSION = 0.65; // stronger separation between detail nodes
const DETAIL_OBSTACLE_PUSH = 0.9; // push harder off anchors/process areas
const DETAIL_DAMPING = 0.78; // slightly less damping so they can move apart faster
const DETAIL_ITERATIONS = 85; // more relaxation passes
const BASE_DETAIL_MIN_DISTANCE = 36; // larger minimum clearance
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

// ========== SPATIAL INDEX & COLLISION DETECTION ==========

const OBSTACLE_PADDING = 8; // Padding around nodes for routing
const NODE_CROSSING_SAMPLE_STEP = 6; // px between samples along a path
const NODE_EXIT_TOLERANCE = 4; // px allowed inside source/target box right after exit/entry
const NODE_HIT_EXPAND = 0.5; // expands node rect slightly for conservative detection
const ROW_ALIGNMENT_TOLERANCE = 6; // px tolerance to treat nodes as same row
const COLUMN_ALIGNMENT_TOLERANCE = 20; // px tolerance to treat nodes as same column by X-position

type PathSegment =
  | { type: 'line'; from: Point2D; to: Point2D; length: number }
  | { type: 'quad'; from: Point2D; control: Point2D; to: Point2D; length: number };

/**
 * Builds a spatial index of all obstacles (nodes and process areas) for edge routing.
 */
function buildSpatialIndex(
  positions: Record<string, NodePosition>,
  areaRects?: Record<string, ObstacleRect>,
  excludeNodeIds?: Set<string>,
): SpatialIndex {
  const nodeObstacles: Obstacle[] = [];
  const areaObstacles: Obstacle[] = [];

  // Add all nodes as obstacles with padding (except excluded ones like detail nodes)
  for (const [id, pos] of Object.entries(positions)) {
    if (excludeNodeIds?.has(id)) continue;
    const halfW = pos.width / 2 + OBSTACLE_PADDING;
    const halfH = pos.height / 2 + OBSTACLE_PADDING;
    nodeObstacles.push({
      id,
      rect: {
        left: pos.centerX - halfW,
        right: pos.centerX + halfW,
        top: pos.centerY - halfH,
        bottom: pos.centerY + halfH,
      },
      type: 'node',
    });
  }

  // Add process areas as obstacles if provided
  if (areaRects) {
    for (const [id, rect] of Object.entries(areaRects)) {
      areaObstacles.push({ id, rect, type: 'area' });
    }
  }

  return {
    obstacles: [...nodeObstacles, ...areaObstacles],
    nodeObstacles,
    areaObstacles,
  };
}

/**
 * Tests if a line segment intersects a rectangle.
 * Uses parametric line intersection with all 4 edges.
 */
function segmentIntersectsRect(
  p1: Point2D,
  p2: Point2D,
  rect: ObstacleRect,
  shrinkAmount = 2, // Shrink rect slightly to avoid false positives at boundaries
): boolean {
  const left = rect.left + shrinkAmount;
  const right = rect.right - shrinkAmount;
  const top = rect.top + shrinkAmount;
  const bottom = rect.bottom - shrinkAmount;

  // Quick bounding box check
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (maxX < left || minX > right || maxY < top || minY > bottom) {
    return false;
  }

  // Check if either endpoint is inside the rectangle
  const pointInRect = (p: Point2D) =>
    p.x > left && p.x < right && p.y > top && p.y < bottom;

  if (pointInRect(p1) || pointInRect(p2)) {
    return true;
  }

  // Check intersection with each edge using parametric line equation
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  // Helper to check if segment crosses a vertical line at x between yMin and yMax
  const crossesVertical = (x: number, yMin: number, yMax: number): boolean => {
    if (Math.abs(dx) < 1e-9) return false;
    const t = (x - p1.x) / dx;
    if (t < 0 || t > 1) return false;
    const y = p1.y + t * dy;
    return y >= yMin && y <= yMax;
  };

  // Helper to check if segment crosses a horizontal line at y between xMin and xMax
  const crossesHorizontal = (y: number, xMin: number, xMax: number): boolean => {
    if (Math.abs(dy) < 1e-9) return false;
    const t = (y - p1.y) / dy;
    if (t < 0 || t > 1) return false;
    const x = p1.x + t * dx;
    return x >= xMin && x <= xMax;
  };

  return (
    crossesVertical(left, top, bottom) ||
    crossesVertical(right, top, bottom) ||
    crossesHorizontal(top, left, right) ||
    crossesHorizontal(bottom, left, right)
  );
}

/**
 * Checks if a route (series of waypoints) crosses any obstacles.
 * Returns the list of obstacles that are crossed.
 */
function routeCrossesObstacles(
  waypoints: Point2D[],
  index: SpatialIndex,
  excludeIds: string[],
): Obstacle[] {
  const crossed: Obstacle[] = [];
  const excludeSet = new Set(excludeIds);

  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];

    // Check node obstacles
    for (const obstacle of index.nodeObstacles) {
      if (excludeSet.has(obstacle.id)) continue;
      if (crossed.some((o) => o.id === obstacle.id)) continue;

      if (segmentIntersectsRect(p1, p2, obstacle.rect)) {
        crossed.push(obstacle);
      }
    }

    // Check area obstacles (process areas)
    for (const obstacle of index.areaObstacles) {
      if (excludeSet.has(obstacle.id)) continue;
      if (crossed.some((o) => o.id === obstacle.id)) continue;

      if (segmentIntersectsRect(p1, p2, obstacle.rect)) {
        crossed.push(obstacle);
      }
    }
  }

  return crossed;
}

function pointInsideRectInclusive(p: Point2D, rect: ObstacleRect, expand = 0): boolean {
  return (
    p.x >= rect.left - expand &&
    p.x <= rect.right + expand &&
    p.y >= rect.top - expand &&
    p.y <= rect.bottom + expand
  );
}

function buildPathSegmentsFromWaypoints(waypoints: Point2D[]): PathSegment[] {
  if (waypoints.length < 2) return [];
  if (waypoints.length === 2) {
    const [from, to] = waypoints;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return [{ type: 'line', from, to, length }];
  }

  const segments: PathSegment[] = [];
  let currentStart = waypoints[0];

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];

    const lenBefore = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenAfter = Math.hypot(next.x - curr.x, next.y - curr.y);
    const cornerRadius = Math.min(lenBefore * 0.4, lenAfter * 0.4, 40);

    const beforeDir = {
      x: (curr.x - prev.x) / Math.max(lenBefore, 1e-6),
      y: (curr.y - prev.y) / Math.max(lenBefore, 1e-6),
    };
    const afterDir = {
      x: (next.x - curr.x) / Math.max(lenAfter, 1e-6),
      y: (next.y - curr.y) / Math.max(lenAfter, 1e-6),
    };

    const curveStart = {
      x: curr.x - beforeDir.x * cornerRadius,
      y: curr.y - beforeDir.y * cornerRadius,
    };
    const curveEnd = {
      x: curr.x + afterDir.x * cornerRadius,
      y: curr.y + afterDir.y * cornerRadius,
    };

    const lineLength = Math.hypot(curveStart.x - currentStart.x, curveStart.y - currentStart.y);
    if (lineLength > 0.5) {
      segments.push({ type: 'line', from: currentStart, to: curveStart, length: lineLength });
    }

    const quadLength =
      Math.hypot(curveStart.x - curr.x, curveStart.y - curr.y) +
      Math.hypot(curveEnd.x - curr.x, curveEnd.y - curr.y);
    segments.push({ type: 'quad', from: curveStart, control: curr, to: curveEnd, length: quadLength });

    currentStart = curveEnd;
  }

  const last = waypoints[waypoints.length - 1];
  const finalLength = Math.hypot(last.x - currentStart.x, last.y - currentStart.y);
  if (finalLength > 0.5) {
    segments.push({ type: 'line', from: currentStart, to: last, length: finalLength });
  }

  return segments;
}

function sampleQuadraticPoint(p0: Point2D, p1: Point2D, p2: Point2D, t: number): Point2D {
  const oneMinusT = 1 - t;
  const x = oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x;
  const y = oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y;
  return { x, y };
}

function samplePathSegments(
  segments: PathSegment[],
  step = NODE_CROSSING_SAMPLE_STEP,
): { samples: Array<{ point: Point2D; distance: number }>; totalLength: number } {
  const samples: Array<{ point: Point2D; distance: number }> = [];
  let distance = 0;

  if (segments.length === 0) {
    return { samples, totalLength: 0 };
  }

  // Seed with the very first point
  const first = segments[0].type === 'line' ? segments[0].from : segments[0].from;
  samples.push({ point: { ...first }, distance });

  segments.forEach((segment) => {
    const segLength = Math.max(segment.length, 0);
    const minSteps = 4;
    const steps = segment.type === 'line'
      ? Math.max(minSteps, Math.ceil(segLength / Math.max(step, 1e-3)))
      : Math.max(minSteps, Math.ceil(segLength / Math.max(step * 0.75, 1e-3)));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      let point: Point2D;
      if (segment.type === 'line') {
        point = {
          x: segment.from.x + (segment.to.x - segment.from.x) * t,
          y: segment.from.y + (segment.to.y - segment.from.y) * t,
        };
      } else {
        point = sampleQuadraticPoint(segment.from, segment.control, segment.to, t);
      }
      const increment =
        segment.type === 'line'
          ? segLength / steps
          : segLength / steps; // approximate; adequate for collision sampling
      distance += increment;
      samples.push({ point, distance });
    }
  });

  return { samples, totalLength: distance };
}

function detectNodeCrossings(
  samples: Array<{ point: Point2D; distance: number }>,
  totalLength: number,
  nodeRects: Array<{ id: string; rect: ObstacleRect }>,
  sourceId: string,
  targetId: string,
): { crosses: boolean; points: Point2D[] } {
  const hits: Point2D[] = [];

  for (const sample of samples) {
    const distFromStart = sample.distance;
    const distFromEnd = Math.max(totalLength - distFromStart, 0);

    for (const node of nodeRects) {
      const isSource = node.id === sourceId;
      const isTarget = node.id === targetId;

      // Allow a tiny escape distance when leaving or entering the endpoint node
      if (isSource && distFromStart <= NODE_EXIT_TOLERANCE) continue;
      if (isTarget && distFromEnd <= NODE_EXIT_TOLERANCE) continue;

      if (pointInsideRectInclusive(sample.point, node.rect, NODE_HIT_EXPAND)) {
        hits.push(sample.point);
        // Capture only a few points to render markers
        if (hits.length >= 4) {
          return { crosses: true, points: hits };
        }
        break;
      }
    }
  }

  return { crosses: hits.length > 0, points: hits };
}

/**
 * Calculates the total length of a route.
 */
function calculateRouteLength(waypoints: Point2D[]): number {
  let length = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    length += Math.hypot(
      waypoints[i + 1].x - waypoints[i].x,
      waypoints[i + 1].y - waypoints[i].y,
    );
  }
  return length;
}

/**
 * Scores a route candidate. Lower scores are better.
 * Penalties:
 * - Node crossing: 500 per node crossed
 * - Route length: 0.5 per pixel
 * - Number of bends: 15ß per bend
 */
function scoreRoute(
  waypoints: Point2D[],
  index: SpatialIndex,
  excludeIds: string[],
): number {
  let score = 0;

  // Penalty for crossing nodes (very high)
  const crossedNodes = routeCrossesObstacles(waypoints, index, excludeIds);
  score += crossedNodes.length * 10;

  // Penalty for route length (encourages shorter routes)
  score += calculateRouteLength(waypoints) * 0; //0.5;

  // Penalty for number of bends (high penalty to prefer simpler L-shapes)
  const numBends = Math.max(0, waypoints.length - 2);
  score += numBends * 350;

  // Penalty for bend points (intermediate waypoints) inside process areas
  // This encourages routes to keep their bends outside of areas
  for (let i = 1; i < waypoints.length - 1; i++) {
    const wp = waypoints[i];
    for (const area of index.areaObstacles) {
      if (excludeIds.includes(area.id)) continue;
      // Check if waypoint is inside this area
      if (
        wp.x > area.rect.left &&
        wp.x < area.rect.right &&
        wp.y > area.rect.top &&
        wp.y < area.rect.bottom
      ) {
        score += 100; // Penalty per waypoint inside an area
      }
    }
  }

  return score;
}

// ========== MULTI-OPTION ROUTE GENERATION ==========

/**
 * Helper to check if a side is horizontal (left/right).
 */
function isHorizontalSide(side: NodeSide): boolean {
  return side === 'left' || side === 'right';
}

/**
 * Gets the attachment point on a specific side of a node (legacy - uses continuous offset).
 */
function getAttachmentPointOnSide(
  node: NodePosition,
  side: NodeSide,
  offset = 0,
): Point2D {
  const halfW = node.width / 2;
  const halfH = node.height / 2;

  switch (side) {
    case 'top':
      return { x: node.centerX + offset, y: node.centerY - halfH };
    case 'bottom':
      return { x: node.centerX + offset, y: node.centerY + halfH };
    case 'left':
      return { x: node.centerX - halfW, y: node.centerY + offset };
    case 'right':
      return { x: node.centerX + halfW, y: node.centerY + offset };
  }
}

/**
 * Gets the attachment point using discrete slots.
 * - Top/Bottom sides have 3 slots: left, center, right
 * - Left/Right sides have 2 slots: top, bottom
 */
function getAttachmentPoint(node: NodePosition, attachment: AttachmentSlot): Point2D {
  const halfW = node.width / 2;
  const halfH = node.height / 2;

  switch (attachment.side) {
    case 'top': {
      const slot = attachment.slot as HorizontalSlot;
      const offsetX = HORIZONTAL_SLOT_POSITIONS[slot] * node.width;
      return { x: node.centerX + offsetX, y: node.centerY - halfH };
    }
    case 'bottom': {
      const slot = attachment.slot as HorizontalSlot;
      const offsetX = HORIZONTAL_SLOT_POSITIONS[slot] * node.width;
      return { x: node.centerX + offsetX, y: node.centerY + halfH };
    }
    case 'left': {
      const slot = attachment.slot as VerticalSlot;
      const offsetY = VERTICAL_SLOT_POSITIONS[slot] * node.height;
      return { x: node.centerX - halfW, y: node.centerY + offsetY };
    }
    case 'right': {
      const slot = attachment.slot as VerticalSlot;
      const offsetY = VERTICAL_SLOT_POSITIONS[slot] * node.height;
      return { x: node.centerX + halfW, y: node.centerY + offsetY };
    }
  }
}

/**
 * Assigns a slot based on edge index and total edges on that side.
 * Uses center when there's only one edge, otherwise distributes across available slots.
 */
function assignSlot(
  side: NodeSide,
  edgeIndex: number,
  totalEdges: number,
): HorizontalSlot | VerticalSlot {
  // Single edge (or untracked edge) on any side uses center
  // totalEdges can be 0 for non-'P' edges that aren't tracked in sourceAttachments
  if (totalEdges <= 1) {
    return 'center';
  }

  // Multiple edges: use non-center slots only to spread them apart
  if (side === 'top' || side === 'bottom') {
    // 2 non-center horizontal slots (left/right)
    const slots: HorizontalSlot[] = ['left', 'right'];
    return slots[edgeIndex % 2];
  } else {
    // 2 non-center vertical slots (top/bottom)
    const slots: VerticalSlot[] = ['top', 'bottom'];
    return slots[edgeIndex % 2];
  }
}

/**
 * Port constraints map: edgeId-source or edgeId-target → forced port
 * Used to enforce single-edge center and straight-edge same-port rules
 */
type PortConstraints = Map<string, HorizontalSlot | VerticalSlot>;

/**
 * Computes port constraints for all edges based on hard rules:
 * 1. Single edge on a side → MUST use center (considering BOTH incoming and outgoing)
 * 2. Straight edges → MUST use same port at both ends
 */
function computePortConstraints(
  edges: EdgeDescriptor[],
  routes: Map<string, RouteCandidate>,
  attachments: AttachmentTracker,
): PortConstraints {
  const constraints: PortConstraints = new Map();

  // Pass 1: Single-edge sides get center constraint
  // Use allAttachments to check if there's truly only ONE edge (either direction) on this side
  for (const [key, edgeList] of attachments.allAttachments) {
    if (edgeList.length === 1) {
      const edge = edgeList[0];
      const route = routes.get(edge.id);
      if (!route) continue;

      // Determine if this edge is source or target at this node-side
      const [nodeId, side] = key.split('-');
      const isSource = edge.from === nodeId;
      const isTarget = edge.to === nodeId;

      if (isSource) {
        constraints.set(edge.id + '-source', 'center');
      }
      if (isTarget) {
        constraints.set(edge.id + '-target', 'center');
      }
    }
  }

  // Pass 2: Straight edges propagate center constraint to other end
  // Iterate until no more changes (handles chains of straight edges)
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const route = routes.get(edge.id);
      const isStraight = route && route.waypoints.length === 2;

      if (isStraight) {
        const sourceKey = edge.id + '-source';
        const targetKey = edge.id + '-target';

        // If target is center-constrained, source must be center too
        if (constraints.get(targetKey) === 'center' && !constraints.has(sourceKey)) {
          constraints.set(sourceKey, 'center');
          changed = true;
        }
        // If source is center-constrained, target must be center too
        if (constraints.get(sourceKey) === 'center' && !constraints.has(targetKey)) {
          constraints.set(targetKey, 'center');
          changed = true;
        }
      }
    }
  }

  return constraints;
}

/**
 * Gets the position for sorting edges to minimize crossings.
 *
 * Key insight: For L-shaped edges, the waypoint (bend point) often has the same Y
 * as the target (for horizontal entry). So sorting by waypoint doesn't work.
 *
 * Instead, sort by the OTHER endpoint position:
 * - For target attachments (edges entering): use SOURCE position
 * - For source attachments (edges leaving): use TARGET position
 *
 * This determines where the edge "comes from" or "goes to" visually.
 */
function getPositionForSorting(
  edge: EdgeDescriptor,
  positions: Record<string, NodePosition>,
  isSourceAttachment: boolean,
): { x: number; y: number } {
  const source = positions[edge.from];
  const target = positions[edge.to];

  if (!source || !target) {
    return { x: 0, y: 0 };
  }

  // Use the OTHER endpoint for sorting:
  // - For edges entering a node (target attachment): sort by source position
  // - For edges leaving a node (source attachment): sort by target position
  if (isSourceAttachment) {
    return { x: target.centerX, y: target.centerY };
  } else {
    return { x: source.centerX, y: source.centerY };
  }
}

/**
 * Sorts edges by their waypoint position for optimal port assignment.
 * - For left/right sides: sort by Y (lower Y → top port)
 * - For top/bottom sides: sort by X (lower X → left port)
 */
/**
 * Sorts edges by the position of their other endpoint to minimize crossings.
 *
 * For edges entering/leaving from the same side, we want to assign ports
 * such that edges don't cross. The key insight:
 *
 * - For RIGHT side: edges from upper-left should use top port, lower-right should use bottom
 * - For LEFT side: edges from upper-right should use top port, lower-left should use bottom
 * - For TOP side: edges from upper-left should use left port, upper-right should use right
 * - For BOTTOM side: edges from lower-left should use left port, lower-right should use right
 *
 * We achieve this by sorting by Y primarily, with X as tiebreaker for similar Y values.
 */
function sortEdgesByPosition(
  edgesToSort: EdgeDescriptor[],
  side: NodeSide,
  positions: Record<string, NodePosition>,
  isSourceAttachment: boolean,
): EdgeDescriptor[] {
  return [...edgesToSort].sort((a, b) => {
    const posA = getPositionForSorting(a, positions, isSourceAttachment);
    const posB = getPositionForSorting(b, positions, isSourceAttachment);

    if (side === 'left' || side === 'right') {
      // Vertical slots: sort by Y (lower Y → top port)
      // Tiebreaker: for similar Y, use X to minimize crossings
      const yDiff = posA.y - posB.y;
      if (Math.abs(yDiff) < 20) {
        // Similar Y values - use X as tiebreaker
        // For RIGHT side: lower X (further left) → top port (to avoid crossing with edges from right)
        // For LEFT side: higher X (further right) → top port (to avoid crossing with edges from left)
        if (side === 'right') {
          return posA.x - posB.x; // Lower X → top
        } else {
          return posB.x - posA.x; // Higher X → top
        }
      }
      return yDiff;
    } else {
      // Horizontal slots: sort by X (lower X → left port)
      // Tiebreaker: for similar X, use Y to minimize crossings
      const xDiff = posA.x - posB.x;
      if (Math.abs(xDiff) < 20) {
        // Similar X values - use Y as tiebreaker
        // For TOP side: lower Y (further up) → left port
        // For BOTTOM side: higher Y (further down) → left port
        if (side === 'top') {
          return posA.y - posB.y; // Lower Y → left
        } else {
          return posB.y - posA.y; // Higher Y → left
        }
      }
      return xDiff;
    }
  });
}

/**
 * Assigns a port for an edge based on constraints and position-based optimization.
 *
 * Hard constraints (always enforced):
 * 1. If edge has a constraint in the map → use that port
 * 2. Single edge on side → center (handled by constraints)
 * 3. Straight edges → same port at both ends (handled by constraints)
 *
 * Optimization (for unconstrained edges):
 * - Sort by other endpoint position (source for target attachments, target for source)
 * - Assign ports to minimize crossings
 * - Use all 3 ports if center is available, or top/bottom if center is taken
 */
function assignPort(
  side: NodeSide,
  edge: EdgeDescriptor,
  edgesOnSameSide: EdgeDescriptor[],
  constraints: PortConstraints,
  positions: Record<string, NodePosition>,
  isSourceAttachment: boolean,
): HorizontalSlot | VerticalSlot {
  const constraintKey = edge.id + (isSourceAttachment ? '-source' : '-target');

  // If this edge has a constraint, return it
  if (constraints.has(constraintKey)) {
    return constraints.get(constraintKey)!;
  }

  // Find which edges on this side are constrained to center
  const constrainedToCenterEdges = edgesOnSameSide.filter((e) => {
    const key = e.id + (isSourceAttachment ? '-source' : '-target');
    return constraints.get(key) === 'center';
  });
  const centerTaken = constrainedToCenterEdges.length > 0;

  // Get unconstrained edges (excluding those constrained to center)
  const unconstrainedEdges = edgesOnSameSide.filter((e) => {
    const key = e.id + (isSourceAttachment ? '-source' : '-target');
    return !constraints.has(key);
  });

  // If this edge is not in the unconstrained list, it's constrained - shouldn't happen but be safe
  if (!unconstrainedEdges.find((e) => e.id === edge.id)) {
    return 'center';
  }

  // Sort unconstrained edges by the position of their other endpoint
  const sorted = sortEdgesByPosition(unconstrainedEdges, side, positions, isSourceAttachment);
  const index = sorted.findIndex((e) => e.id === edge.id);

  if (index === -1) return 'center';

  // Assign ports based on sorted position
  if (side === 'left' || side === 'right') {
    // Vertical slots: top, center, bottom
    if (centerTaken) {
      // Center is taken, use only top/bottom
      const slots: VerticalSlot[] = ['top', 'bottom'];
      return slots[index % 2];
    } else {
      // Center is available, use all 3 slots
      const slots: VerticalSlot[] = ['top', 'center', 'bottom'];
      return slots[Math.min(index, 2)];
    }
  } else {
    // Horizontal slots: left, center, right
    if (centerTaken) {
      // Center is taken, use only left/right
      const slots: HorizontalSlot[] = ['left', 'right'];
      return slots[index % 2];
    } else {
      // Center is available, use all 3 slots
      const slots: HorizontalSlot[] = ['left', 'center', 'right'];
      return slots[Math.min(index, 2)];
    }
  }
}

/**
 * Chooses matching slots for straight edges to ensure perfect horizontal/vertical lines.
 * Returns null if nodes are not aligned for a straight edge.
 */
function chooseStraightEdgeSlots(
  source: NodePosition,
  target: NodePosition,
): { sourceSlot: AttachmentSlot; targetSlot: AttachmentSlot } | null {
  const dx = target.centerX - source.centerX;
  const dy = target.centerY - source.centerY;

  // Check if mostly horizontal (can use right→left)
  if (Math.abs(dx) > Math.abs(dy) * 2 && dx > source.width / 2 + target.width / 2) {
    // Target is to the right - exit right, enter left
    // Determine which vertical slot based on relative Y position
    const relativeY = dy / source.height;
    const slot: VerticalSlot = relativeY < -0.15 ? 'top' : relativeY > 0.15 ? 'bottom' : 'center';
    return {
      sourceSlot: { side: 'right', slot },
      targetSlot: { side: 'left', slot }, // Same slot for straight line
    };
  }

  // Check if mostly horizontal going left
  if (Math.abs(dx) > Math.abs(dy) * 2 && dx < -(source.width / 2 + target.width / 2)) {
    // Target is to the left - exit left, enter right
    const relativeY = dy / source.height;
    const slot: VerticalSlot = relativeY < -0.15 ? 'top' : relativeY > 0.15 ? 'bottom' : 'center';
    return {
      sourceSlot: { side: 'left', slot },
      targetSlot: { side: 'right', slot },
    };
  }

  // Check if mostly vertical going down (can use bottom→top)
  if (Math.abs(dy) > Math.abs(dx) * 2 && dy > source.height / 2 + target.height / 2) {
    const relativeX = dx / source.width;
    const slot: HorizontalSlot =
      relativeX < -0.15 ? 'left' : relativeX > 0.15 ? 'right' : 'center';
    return {
      sourceSlot: { side: 'bottom', slot },
      targetSlot: { side: 'top', slot }, // Same slot for straight line
    };
  }

  // Check if mostly vertical going up (can use top→bottom)
  if (Math.abs(dy) > Math.abs(dx) * 2 && dy < -(source.height / 2 + target.height / 2)) {
    const relativeX = dx / source.width;
    const slot: HorizontalSlot =
      relativeX < -0.15 ? 'left' : relativeX > 0.15 ? 'right' : 'center';
    return {
      sourceSlot: { side: 'top', slot },
      targetSlot: { side: 'bottom', slot },
    };
  }

  return null; // Not suitable for straight edge
}

/**
 * Generates an L-shape route with specific exit/entry sides.
 * Returns waypoints: [start, corner, end]
 */
function generateLShapeRoute(
  source: NodePosition,
  target: NodePosition,
  sourceExit: NodeSide,
  targetEntry: NodeSide,
  sourceOffset = 0,
  targetOffset = 0,
): Point2D[] {
  const startPoint = getAttachmentPointOnSide(source, sourceExit, sourceOffset);
  const endPoint = getAttachmentPointOnSide(target, targetEntry, targetOffset);

  // Determine corner based on exit/entry orientations
  const sourceHorizontal = isHorizontalSide(sourceExit);
  const targetHorizontal = isHorizontalSide(targetEntry);

  if (sourceHorizontal === targetHorizontal) {
    // Same orientation - need 3-segment route (handled elsewhere)
    // For now, create a reasonable L-shape
    const midX = (startPoint.x + endPoint.x) / 2;
    const midY = (startPoint.y + endPoint.y) / 2;
    if (sourceHorizontal) {
      return [startPoint, { x: midX, y: startPoint.y }, { x: midX, y: endPoint.y }, endPoint];
    } else {
      return [startPoint, { x: startPoint.x, y: midY }, { x: endPoint.x, y: midY }, endPoint];
    }
  }

  // Different orientations - true L-shape
  let corner: Point2D;
  if (sourceHorizontal) {
    // Exit horizontal, enter vertical → corner at (endX, startY)
    corner = { x: endPoint.x, y: startPoint.y };
  } else {
    // Exit vertical, enter horizontal → corner at (startX, endY)
    corner = { x: startPoint.x, y: endPoint.y };
  }

  return [startPoint, corner, endPoint];
}

/**
 * Generates a 3-segment route that goes around obstacles.
 * Creates S-shape or Z-shape routes.
 */
function generateThreeSegmentRoute(
  source: NodePosition,
  target: NodePosition,
  sourceExit: NodeSide,
  targetEntry: NodeSide,
  index: SpatialIndex,
  excludeIds: string[],
  sourceOffset = 0,
  targetOffset = 0,
): Point2D[] {
  const startPoint = getAttachmentPointOnSide(source, sourceExit, sourceOffset);
  const endPoint = getAttachmentPointOnSide(target, targetEntry, targetOffset);

  const sourceHorizontal = isHorizontalSide(sourceExit);

  // Determine the intermediate routing channel
  // Try routing above, below, left, or right of the direct path
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;

  // Calculate potential detour distances
  const detourAmount = Math.max(60, Math.min(Math.abs(dx), Math.abs(dy)) * 0.4);

  const candidates: Point2D[][] = [];

  if (sourceHorizontal) {
    // Source exits horizontally
    // Try routing via a horizontal channel above or below
    const midY1 = startPoint.y - detourAmount; // above
    const midY2 = startPoint.y + detourAmount; // below

    // Route above
    candidates.push([
      startPoint,
      { x: startPoint.x + (dx > 0 ? detourAmount : -detourAmount), y: startPoint.y },
      { x: startPoint.x + (dx > 0 ? detourAmount : -detourAmount), y: midY1 },
      { x: endPoint.x, y: midY1 },
      endPoint,
    ]);

    // Route below
    candidates.push([
      startPoint,
      { x: startPoint.x + (dx > 0 ? detourAmount : -detourAmount), y: startPoint.y },
      { x: startPoint.x + (dx > 0 ? detourAmount : -detourAmount), y: midY2 },
      { x: endPoint.x, y: midY2 },
      endPoint,
    ]);
  } else {
    // Source exits vertically
    // Try routing via a vertical channel left or right
    const midX1 = startPoint.x - detourAmount; // left
    const midX2 = startPoint.x + detourAmount; // right

    // Route left
    candidates.push([
      startPoint,
      { x: startPoint.x, y: startPoint.y + (dy > 0 ? detourAmount : -detourAmount) },
      { x: midX1, y: startPoint.y + (dy > 0 ? detourAmount : -detourAmount) },
      { x: midX1, y: endPoint.y },
      endPoint,
    ]);

    // Route right
    candidates.push([
      startPoint,
      { x: startPoint.x, y: startPoint.y + (dy > 0 ? detourAmount : -detourAmount) },
      { x: midX2, y: startPoint.y + (dy > 0 ? detourAmount : -detourAmount) },
      { x: midX2, y: endPoint.y },
      endPoint,
    ]);
  }

  // Score all candidates and return the best one
  let bestRoute = candidates[0];
  let bestScore = scoreRoute(bestRoute, index, excludeIds);

  for (let i = 1; i < candidates.length; i++) {
    const score = scoreRoute(candidates[i], index, excludeIds);
    if (score < bestScore) {
      bestScore = score;
      bestRoute = candidates[i];
    }
  }

  return bestRoute;
}

/**
 * Generates a C-shape (U-shape) route that exits and enters from the same side.
 * Used for routing around obstacles when L-shapes would cross them.
 */
function generateCShapeRoute(
  source: NodePosition,
  target: NodePosition,
  side: 'left' | 'right',
  index: SpatialIndex,
  excludeIds: string[],
  sourceOffset = 0,
  targetOffset = 0,
): Point2D[] {
  const startPoint = getAttachmentPointOnSide(source, side, sourceOffset);
  const endPoint = getAttachmentPointOnSide(target, side, targetOffset);

  // Find the leftmost/rightmost obstacle edge to route around
  const allObstacles = [...index.nodeObstacles, ...index.areaObstacles].filter(
    (o) => !excludeIds.includes(o.id),
  );

  let routeX: number;
  if (side === 'left') {
    // Route to the left of all obstacles
    const leftmostEdge = Math.min(
      startPoint.x,
      endPoint.x,
      ...allObstacles.map((o) => o.rect.left),
    );
    routeX = leftmostEdge - 40; // 40px clearance
  } else {
    // Route to the right of all obstacles
    const rightmostEdge = Math.max(
      startPoint.x,
      endPoint.x,
      ...allObstacles.map((o) => o.rect.right),
    );
    routeX = rightmostEdge + 40;
  }

  // C-shape: horizontal out, vertical, horizontal back in
  return [startPoint, { x: routeX, y: startPoint.y }, { x: routeX, y: endPoint.y }, endPoint];
}

/**
 * Checks if a given exit/entry combination is valid for the node positions.
 */
function isValidExitEntryCombination(
  source: NodePosition,
  target: NodePosition,
  sourceExit: NodeSide,
  targetEntry: NodeSide,
): boolean {
  const dx = target.centerX - source.centerX;
  const dy = target.centerY - source.centerY;

  // Reject clearly nonsensical combinations
  // e.g., exiting right when target is to the left
  if (sourceExit === 'right' && dx < -source.width) return false;
  if (sourceExit === 'left' && dx > source.width) return false;
  if (sourceExit === 'bottom' && dy < -source.height) return false;
  if (sourceExit === 'top' && dy > source.height) return false;

  // Similar checks for target entry
  if (targetEntry === 'left' && dx < -target.width) return false;
  if (targetEntry === 'right' && dx > target.width) return false;
  if (targetEntry === 'top' && dy < -target.height) return false;
  if (targetEntry === 'bottom' && dy > target.height) return false;

  return true;
}

/**
 * Finds the best route between two nodes.
 * Strategy: Prefer the default L-shape from determineLShapeConfig.
 * Only explore alternatives if the default crosses a node.
 */
function findBestRoute(
  source: NodePosition,
  target: NodePosition,
  sourceId: string,
  targetId: string,
  index: SpatialIndex,
  sourceOffset = 0,
  targetOffset = 0,
): RouteCandidate {
  const excludeIds = [sourceId, targetId];

  // First, try the default L-shape from determineLShapeConfig
  // This gives predictable, clean routing for most cases
  const defaultConfig = determineLShapeConfig(
    { x: source.centerX, y: source.centerY },
    { x: target.centerX, y: target.centerY },
  );

  const defaultRoute = generateLShapeRoute(
    source,
    target,
    defaultConfig.sourceExit,
    defaultConfig.targetEntry,
    sourceOffset,
    targetOffset,
  );

  const defaultCrossings = routeCrossesObstacles(defaultRoute, index, excludeIds);

  // If the default L-shape doesn't cross any nodes, use it directly
  if (defaultCrossings.length === 0) {
    return {
      waypoints: defaultRoute,
      sourceExit: defaultConfig.sourceExit,
      targetEntry: defaultConfig.targetEntry,
      score: 0, // Perfect score for default route with no crossings
    };
  }

  // Default route crosses nodes - search for alternatives
  const SIDES: NodeSide[] = ['top', 'bottom', 'left', 'right'];
  const candidates: RouteCandidate[] = [];

  // Add the default route as a candidate (fallback if nothing better found)
  candidates.push({
    waypoints: defaultRoute,
    sourceExit: defaultConfig.sourceExit,
    targetEntry: defaultConfig.targetEntry,
    score: scoreRoute(defaultRoute, index, excludeIds),
  });

  // Try alternative exit/entry combinations
  for (const sourceExit of SIDES) {
    for (const targetEntry of SIDES) {
      // Skip the default combination (already added)
      if (sourceExit === defaultConfig.sourceExit && targetEntry === defaultConfig.targetEntry) {
        continue;
      }

      if (!isValidExitEntryCombination(source, target, sourceExit, targetEntry)) {
        continue;
      }

      // Generate L-shape route for this combination
      const lRoute = generateLShapeRoute(
        source,
        target,
        sourceExit,
        targetEntry,
        sourceOffset,
        targetOffset,
      );
      const lScore = scoreRoute(lRoute, index, excludeIds);
      candidates.push({
        waypoints: lRoute,
        sourceExit,
        targetEntry,
        score: lScore,
      });

      // If this L-shape also crosses obstacles, try 3-segment route
      const crossedObstacles = routeCrossesObstacles(lRoute, index, excludeIds);
      if (crossedObstacles.length > 0) {
        const sRoute = generateThreeSegmentRoute(
          source,
          target,
          sourceExit,
          targetEntry,
          index,
          excludeIds,
          sourceOffset,
          targetOffset,
        );
        const sScore = scoreRoute(sRoute, index, excludeIds);
        candidates.push({
          waypoints: sRoute,
          sourceExit,
          targetEntry,
          score: sScore,
        });
      }
    }
  }

  // Try C-shapes (same-side exit/entry for obstacle avoidance)
  const cShapeSides: Array<'left' | 'right'> = ['left', 'right'];
  for (const side of cShapeSides) {
    const cRoute = generateCShapeRoute(
      source,
      target,
      side,
      index,
      excludeIds,
      sourceOffset,
      targetOffset,
    );
    const cScore = scoreRoute(cRoute, index, excludeIds);
    candidates.push({
      waypoints: cRoute,
      sourceExit: side,
      targetEntry: side,
      score: cScore,
    });
  }

  // Return the candidate with the lowest score
  return candidates.reduce((best, current) =>
    current.score < best.score ? current : best,
  );
}

/**
 * Builds a smooth curved path from waypoints.
 * Converts orthogonal waypoints into smooth Bezier curves.
 */
function buildCurvedPathFromWaypoints(
  waypoints: Point2D[],
  options?: { cornerScale?: number; maxCornerRadius?: number; minCornerRadius?: number },
): string {
  if (waypoints.length < 2) {
    return '';
  }

  if (waypoints.length === 2) {
    return `M ${waypoints[0].x} ${waypoints[0].y} L ${waypoints[1].x} ${waypoints[1].y}`;
  }

  const dynamicCornerScale = options?.cornerScale ?? 0.4;
  const dynamicMaxRadius = options?.maxCornerRadius ?? 40;
  const dynamicMinRadius = options?.minCornerRadius ?? 0;

  // For 3+ points, create smooth curves through the corners
  const parts: string[] = [`M ${waypoints[0].x} ${waypoints[0].y}`];

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const next = waypoints[i + 1];

    // Calculate corner radius based on segment lengths
    const lenBefore = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const lenAfter = Math.hypot(next.x - curr.x, next.y - curr.y);
    const cornerRadius = Math.max(
      dynamicMinRadius,
      Math.min(lenBefore * dynamicCornerScale, lenAfter * dynamicCornerScale, dynamicMaxRadius),
    );

    // Calculate points along segments where curve should start/end
    const beforeDir = {
      x: (curr.x - prev.x) / lenBefore,
      y: (curr.y - prev.y) / lenBefore,
    };
    const afterDir = {
      x: (next.x - curr.x) / lenAfter,
      y: (next.y - curr.y) / lenAfter,
    };

    const curveStart = {
      x: curr.x - beforeDir.x * cornerRadius,
      y: curr.y - beforeDir.y * cornerRadius,
    };
    const curveEnd = {
      x: curr.x + afterDir.x * cornerRadius,
      y: curr.y + afterDir.y * cornerRadius,
    };

    // Line to the curve start, then quadratic Bezier through the corner
    parts.push(`L ${curveStart.x} ${curveStart.y}`);
    parts.push(`Q ${curr.x} ${curr.y} ${curveEnd.x} ${curveEnd.y}`);
  }

  // Line to the final point
  const last = waypoints[waypoints.length - 1];
  parts.push(`L ${last.x} ${last.y}`);

  return parts.join(' ');
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
  sourceNormal,
  targetNormal,
  targetUnitX,
  targetUnitY,
  targetPathLength,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  pathLength: number;
  edgeScale: number;
  sourceNormal?: Point2D;
  targetNormal?: Point2D;
  targetUnitX?: number;
  targetUnitY?: number;
  targetPathLength?: number;
}): {
  bars: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  innerOffset: number | null;
} {
  // Use separate lengths for source and target segment calculations
  const sourceEffectiveLength = Math.max(pathLength, 1);
  const targetEffectiveLength = Math.max(targetPathLength ?? pathLength, 1);
  const effectiveLength = Math.min(sourceEffectiveLength, targetEffectiveLength);
  if (!Number.isFinite(effectiveLength) || effectiveLength <= 0) {
    return { bars: [], innerOffset: null };
  }

  const tolerance = 0.15 * edgeScale;
  const barHeight = Math.min(
    Math.max(10 * edgeScale, effectiveLength * 0.28),
    20 * edgeScale,
  );
  const halfPerp = barHeight;

  // Default perpendicular based on edge direction
  const defaultPerpX = -unitY;
  const defaultPerpY = unitX;

  // Calculate perpendiculars from the box normals (tangent to box edge)
  // The tangent to a normal (nx, ny) is (-ny, nx)
  const sourcePerpX = sourceNormal ? -sourceNormal.y : defaultPerpX;
  const sourcePerpY = sourceNormal ? sourceNormal.x : defaultPerpY;
  const targetPerpX = targetNormal ? -targetNormal.y : defaultPerpX;
  const targetPerpY = targetNormal ? targetNormal.x : defaultPerpY;

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

  // Track positions with their type (near source or near target)
  const barPositions: Array<{ point: Point2D; nearSource: boolean }> = [];
  const addPosition = (point: Point2D, nearSource: boolean) => {
    if (
      barPositions.some(
        (existing) => Math.hypot(existing.point.x - point.x, existing.point.y - point.y) <= tolerance,
      )
    ) {
      return;
    }
    barPositions.push({ point, nearSource });
  };

  // Use source segment direction for source bars, target segment direction for target bars
  const tUnitX = targetUnitX ?? unitX;
  const tUnitY = targetUnitY ?? unitY;

  uniqueOffsets.forEach((offset) => {
    addPosition(
      { x: startX + unitX * offset, y: startY + unitY * offset },
      true, // near source - use source segment direction
    );
    addPosition(
      { x: endX - tUnitX * offset, y: endY - tUnitY * offset },
      false, // near target - use target segment direction
    );
  });

  if (barPositions.length === 0) {
    addPosition({ x: startX, y: startY }, true);
    addPosition({ x: endX, y: endY }, false);
  }

  const innerLimit = uniqueOffsets.length >= 2 ? uniqueOffsets[uniqueOffsets.length - 1] : null;
  const trimmedPositions = barPositions.slice(0, 4);

  return {
    bars: trimmedPositions.map(({ point, nearSource }) => {
      // Use source perpendicular for bars near source, target perpendicular for bars near target
      const perpX = nearSource ? sourcePerpX : targetPerpX;
      const perpY = nearSource ? sourcePerpY : targetPerpY;
      return {
        x1: point.x + perpX * halfPerp,
        y1: point.y + perpY * halfPerp,
        x2: point.x - perpX * halfPerp,
        y2: point.y - perpY * halfPerp,
      };
    }),
    innerOffset: innerLimit,
  };
}

const COLLISION_EPSILON = 1e-5;

/**
 * Determines which side of a node a point is on (or closest to)
 */
function determineNodeSide(
  point: Point2D,
  center: Point2D,
  width: number,
  height: number,
): NodeSide {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const halfW = width / 2;
  const halfH = height / 2;

  // Check if point is on an edge (within tolerance)
  const onVerticalEdge = Math.abs(Math.abs(dx) - halfW) < 2;
  const onHorizontalEdge = Math.abs(Math.abs(dy) - halfH) < 2;

  if (onVerticalEdge && !onHorizontalEdge) {
    return dx > 0 ? 'right' : 'left';
  }
  if (onHorizontalEdge && !onVerticalEdge) {
    return dy > 0 ? 'bottom' : 'top';
  }

  // Fallback: determine by which edge is closer (normalized)
  const normalizedDx = Math.abs(dx) / halfW;
  const normalizedDy = Math.abs(dy) / halfH;

  if (normalizedDx > normalizedDy) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'bottom' : 'top';
}

/**
 * L-shape configuration for edge routing.
 * Every curved edge is conceptually an L-shaped path with a horizontal and vertical segment.
 */
type LShapeConfig = {
  sourceExit: NodeSide;
  targetEntry: NodeSide;
  isHorizontalFirst: boolean;
};

/**
 * Determines the L-shape configuration for an edge based on source/target positions.
 *
 * Rule: Think of the edge as an L with a horizontal (—) and vertical (|) segment.
 * - If dx and dy have OPPOSITE signs → Horizontal-first (source exits side, target enters top/bottom)
 * - If dx and dy have SAME signs → Vertical-first (source exits top/bottom, target enters side)
 */
function determineLShapeConfig(
  sourceCenter: Point2D,
  targetCenter: Point2D,
): LShapeConfig {
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  // Handle edge cases where dx or dy is near zero
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    // Nodes are nearly overlapping, use default
    return { sourceExit: 'bottom', targetEntry: 'top', isHorizontalFirst: false };
  }
  if (Math.abs(dx) < 1) {
    // Purely vertical - treat as vertical-first
    return {
      sourceExit: dy > 0 ? 'bottom' : 'top',
      targetEntry: dy > 0 ? 'top' : 'bottom',
      isHorizontalFirst: false,
    };
  }
  if (Math.abs(dy) < 1) {
    // Purely horizontal - treat as horizontal-first
    return {
      sourceExit: dx > 0 ? 'right' : 'left',
      targetEntry: dx > 0 ? 'left' : 'right',
      isHorizontalFirst: true,
    };
  }

  // Same signs = horizontal-first, opposite signs = vertical-first
  // This makes edges bend AWAY from the diagonal, routing through empty space
  const isHorizontalFirst = (dx > 0) === (dy > 0);

  if (isHorizontalFirst) {
    // L-shape: horizontal from source, then vertical to target
    // Source exits from left/right side, target enters from top/bottom
    return {
      sourceExit: dx > 0 ? 'right' : 'left',
      targetEntry: dy > 0 ? 'top' : 'bottom',
      isHorizontalFirst: true,
    };
  } else {
    // L-shape: vertical from source, then horizontal to target
    // Source exits from top/bottom, target enters from left/right side
    return {
      sourceExit: dy > 0 ? 'bottom' : 'top',
      targetEntry: dx > 0 ? 'left' : 'right',
      isHorizontalFirst: false,
    };
  }
}

/**
 * Predicts which side an edge will attach to based on L-shape routing logic.
 */
function predictAttachmentSide(
  sourceCenter: Point2D,
  targetCenter: Point2D,
  isSource: boolean,
): NodeSide {
  const config = determineLShapeConfig(sourceCenter, targetCenter);
  return isSource ? config.sourceExit : config.targetEntry;
}

/**
 * Builds a tracker of which edges attach to which node sides
 */
function buildAttachmentTracker(
  edges: EdgeDescriptor[],
  positions: Record<string, NodePosition>,
): AttachmentTracker {
  const targetAttachments = new Map<string, EdgeDescriptor[]>();
  const sourceAttachments = new Map<string, EdgeDescriptor[]>();
  const allAttachments = new Map<string, EdgeDescriptor[]>();

  for (const edge of edges) {
    const source = positions[edge.from];
    const target = positions[edge.to];
    if (!source || !target) continue;

    const sourceCenter = { x: source.centerX, y: source.centerY };
    const targetCenter = { x: target.centerX, y: target.centerY };

    // Predict attachment sides
    const sourceSide = predictAttachmentSide(sourceCenter, targetCenter, true);
    const targetSide = predictAttachmentSide(sourceCenter, targetCenter, false);
    const sourceKey = `${edge.from}-${sourceSide}`;
    const targetKey = `${edge.to}-${targetSide}`;

    // Track target attachments (all edges)
    if (!targetAttachments.has(targetKey)) {
      targetAttachments.set(targetKey, []);
    }
    targetAttachments.get(targetKey)!.push(edge);

    // Track source attachments (P edges only)
    if (edge.relation === 'P') {
      if (!sourceAttachments.has(sourceKey)) {
        sourceAttachments.set(sourceKey, []);
      }
      sourceAttachments.get(sourceKey)!.push(edge);
    }

    // Track ALL attachments (both source and target, all edge types)
    if (!allAttachments.has(sourceKey)) {
      allAttachments.set(sourceKey, []);
    }
    allAttachments.get(sourceKey)!.push(edge);

    if (!allAttachments.has(targetKey)) {
      allAttachments.set(targetKey, []);
    }
    allAttachments.get(targetKey)!.push(edge);
  }

  // Sort each attachment list by priority (P first, then D, I, A)
  const sortByPriority = (a: EdgeDescriptor, b: EdgeDescriptor) =>
    RELATION_PRIORITY[a.relation] - RELATION_PRIORITY[b.relation];

  for (const list of targetAttachments.values()) {
    list.sort(sortByPriority);
  }
  for (const list of sourceAttachments.values()) {
    list.sort(sortByPriority);
  }
  for (const list of allAttachments.values()) {
    list.sort(sortByPriority);
  }

  return { targetAttachments, sourceAttachments, allAttachments };
}

/**
 * Builds attachment tracker using ACTUAL route sides (not predicted).
 * This ensures edges are grouped by their real attachment points.
 */
function buildAttachmentTrackerFromRoutes(
  edges: EdgeDescriptor[],
  routes: Map<string, RouteCandidate>,
): AttachmentTracker {
  const targetAttachments = new Map<string, EdgeDescriptor[]>();
  const sourceAttachments = new Map<string, EdgeDescriptor[]>();
  const allAttachments = new Map<string, EdgeDescriptor[]>();

  const sortByPriority = (a: EdgeDescriptor, b: EdgeDescriptor) =>
    RELATION_PRIORITY[a.relation] - RELATION_PRIORITY[b.relation];

  edges.forEach((edge) => {
    const route = routes.get(edge.id);
    if (!route) return;

    const { sourceExit, targetEntry } = route;
    const sourceKey = `${edge.from}-${sourceExit}`;
    const targetKey = `${edge.to}-${targetEntry}`;

    // Track target attachments (all edges)
    if (!targetAttachments.has(targetKey)) {
      targetAttachments.set(targetKey, []);
    }
    targetAttachments.get(targetKey)!.push(edge);

    // Track source attachments (P edges only)
    if (edge.relation === 'P') {
      if (!sourceAttachments.has(sourceKey)) {
        sourceAttachments.set(sourceKey, []);
      }
      sourceAttachments.get(sourceKey)!.push(edge);
    }

    // Track ALL attachments (both source and target, all edge types)
    // This is used for port assignment so incoming/outgoing edges don't overlap
    if (!allAttachments.has(sourceKey)) {
      allAttachments.set(sourceKey, []);
    }
    allAttachments.get(sourceKey)!.push(edge);

    if (!allAttachments.has(targetKey)) {
      allAttachments.set(targetKey, []);
    }
    allAttachments.get(targetKey)!.push(edge);
  });

  // Sort by relation priority
  for (const list of targetAttachments.values()) {
    list.sort(sortByPriority);
  }
  for (const list of sourceAttachments.values()) {
    list.sort(sortByPriority);
  }
  for (const list of allAttachments.values()) {
    list.sort(sortByPriority);
  }

  return { targetAttachments, sourceAttachments, allAttachments };
}

/**
 * Calculates the offset for an edge's attachment point
 */
function getAttachmentOffset(
  edge: EdgeDescriptor,
  attachmentList: EdgeDescriptor[] | undefined,
  nodeSize: number,
  edgeScale: number,
): number {
  if (!attachmentList || attachmentList.length <= 1) {
    return 0;
  }

  const index = attachmentList.findIndex((e) => e.id === edge.id);
  if (index === -1) return 0;

  const count = attachmentList.length;
  const maxSpread = Math.min(nodeSize * 0.5, 40 * edgeScale);
  const spacing = Math.min(maxSpread / Math.max(count - 1, 1), 16 * edgeScale);
  const totalSpan = spacing * (count - 1);
  const startOffset = -totalSpan / 2;

  return startOffset + index * spacing;
}

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

/**
 * Calculates the inward-facing normal perpendicular to the box edge
 * at the collision point. This ensures arrow heads and parallel bars
 * are always perpendicular/parallel to the node boundary.
 */
function calculatePerpendicularBoxNormal(
  tail: Point2D,
  head: Point2D,
  headWidth: number,
  headHeight: number,
): Point2D {
  const deltaX = tail.x - head.x;
  const deltaY = tail.y - head.y;

  const halfWidth = Math.max(headWidth / 2, COLLISION_EPSILON);
  const halfHeight = Math.max(headHeight / 2, COLLISION_EPSILON);

  // Pure vertical approach - hitting top or bottom edge
  if (Math.abs(deltaX) < COLLISION_EPSILON) {
    return { x: 0, y: deltaY > 0 ? -1 : 1 };
  }

  // Pure horizontal approach - hitting left or right edge
  if (Math.abs(deltaY) < COLLISION_EPSILON) {
    return { x: deltaX > 0 ? -1 : 1, y: 0 };
  }

  // Calculate which edge is hit first
  const tHorizontal = Math.abs(halfHeight / deltaY);
  const tVertical = Math.abs(halfWidth / deltaX);

  if (tVertical < tHorizontal) {
    // Hitting left or right edge - normal is horizontal
    return { x: deltaX > 0 ? -1 : 1, y: 0 };
  } else if (tHorizontal < tVertical) {
    // Hitting top or bottom edge - normal is vertical
    return { x: 0, y: deltaY > 0 ? -1 : 1 };
  } else {
    // Hitting corner exactly - use diagonal normal (normalized)
    const cornerNormalX = deltaX > 0 ? -1 : 1;
    const cornerNormalY = deltaY > 0 ? -1 : 1;
    const cornerMag = Math.SQRT2;
    return { x: cornerNormalX / cornerMag, y: cornerNormalY / cornerMag };
  }
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

/**
 * Recalculates arrow heads, parallel bars, or dependent caps based on the final waypoints.
 * This should be called after post-processing changes the edge path.
 */
function recalculateEdgeDecorations(
  segment: EdgeSegment,
  waypoints: Point2D[],
  relation: string,
  edgeScale: number,
  curveOptions?: { cornerScale?: number; maxCornerRadius?: number; minCornerRadius?: number },
): void {
  if (waypoints.length < 2) return;

  const startPoint = waypoints[0];
  const endPoint = waypoints[waypoints.length - 1];
  let updatedWaypoints = waypoints.slice();
  let pathNeedsUpdate = false;
  let renderStart: Point2D = startPoint;
  let renderEnd: Point2D = endPoint;

  // Calculate first and final segment directions
  let firstSegmentDx = endPoint.x - startPoint.x;
  let firstSegmentDy = endPoint.y - startPoint.y;
  let firstSegmentLength = Math.hypot(firstSegmentDx, firstSegmentDy);
  let finalSegmentDx = firstSegmentDx;
  let finalSegmentDy = firstSegmentDy;
  let finalSegmentLength = firstSegmentLength;

  if (waypoints.length >= 3) {
    // First segment: start → second waypoint
    const secondWaypoint = waypoints[1];
    firstSegmentDx = secondWaypoint.x - startPoint.x;
    firstSegmentDy = secondWaypoint.y - startPoint.y;
    firstSegmentLength = Math.hypot(firstSegmentDx, firstSegmentDy);
    if (!Number.isFinite(firstSegmentLength) || firstSegmentLength < 1) {
      firstSegmentDx = endPoint.x - startPoint.x;
      firstSegmentDy = endPoint.y - startPoint.y;
      firstSegmentLength = Math.hypot(firstSegmentDx, firstSegmentDy);
    }

    // Final segment: second-to-last → end
    const secondToLast = waypoints[waypoints.length - 2];
    finalSegmentDx = endPoint.x - secondToLast.x;
    finalSegmentDy = endPoint.y - secondToLast.y;
    finalSegmentLength = Math.hypot(finalSegmentDx, finalSegmentDy);
    if (!Number.isFinite(finalSegmentLength) || finalSegmentLength < 1) {
      finalSegmentDx = endPoint.x - startPoint.x;
      finalSegmentDy = endPoint.y - startPoint.y;
      finalSegmentLength = Math.hypot(finalSegmentDx, finalSegmentDy);
    }
  }

  if (!Number.isFinite(finalSegmentLength) || finalSegmentLength < 1) return;

  const dirFinalX = finalSegmentDx / finalSegmentLength;
  const dirFinalY = finalSegmentDy / finalSegmentLength;
  const dirFirstX = firstSegmentDx / firstSegmentLength;
  const dirFirstY = firstSegmentDy / firstSegmentLength;

  // Target normal points inward along final segment direction
  const targetNormal: Point2D = { x: dirFinalX, y: dirFinalY };
  // Source normal points outward (opposite of first segment direction)
  const sourceNormal: Point2D = { x: -dirFirstX, y: -dirFirstY };

  const collisionX = endPoint.x;
  const collisionY = endPoint.y;

  if (relation === 'I') {
    // Recalculate arrow head
    const maxApproach = Math.max(finalSegmentLength - 4 * edgeScale, 0);
    const baseArrowLength = Math.min(
      Math.max(18, finalSegmentLength * 0.45),
      maxApproach,
    );
    const arrowLength = Math.min(baseArrowLength * edgeScale, maxApproach);
    if (arrowLength > 8) {
      const endX = collisionX - targetNormal.x * arrowLength;
      const endY = collisionY - targetNormal.y * arrowLength;
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
      segment.arrowPath = `M ${leftBaseX} ${leftBaseY} L ${collisionX} ${collisionY} L ${rightBaseX} ${rightBaseY} Z`;
      renderEnd = { x: endX, y: endY };
      updatedWaypoints[updatedWaypoints.length - 1] = renderEnd;
      pathNeedsUpdate = true;
    } else {
      segment.arrowPath = undefined;
    }
  } else if (relation === 'D') {
    // Recalculate dependent cap
    const rawCap = Math.min(
      Math.max(12 * edgeScale, finalSegmentLength * 0.35),
      24 * edgeScale,
    );
    const maxAvailable = Math.max(finalSegmentLength - 8 * edgeScale, 0);
    const capLength = Math.min(rawCap, maxAvailable);
    if (capLength > 1) {
      const baseX = collisionX - dirFinalX * capLength;
      const baseY = collisionY - dirFinalY * capLength;
      const cap = buildDependentCap({
        baseX,
        baseY,
        tipX: collisionX,
        tipY: collisionY,
        normalX: targetNormal.x,
        normalY: targetNormal.y,
        effectiveLength: finalSegmentLength,
        edgeScale,
      });
      segment.capPath = cap;
      renderEnd = { x: baseX, y: baseY };
      updatedWaypoints[updatedWaypoints.length - 1] = renderEnd;
      pathNeedsUpdate = true;
    } else {
      segment.capPath = undefined;
    }
  } else if (relation === 'P') {
    // Recalculate parallel bars
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.hypot(dx, dy);
    if (Number.isFinite(length) && length >= 1) {
      const parallelInfo = buildParallelBars({
        startX: startPoint.x,
        startY: startPoint.y,
        endX: endPoint.x,
        endY: endPoint.y,
        unitX: dirFirstX,
        unitY: dirFirstY,
        pathLength: firstSegmentLength,
        edgeScale,
        sourceNormal,
        targetNormal,
        targetUnitX: dirFinalX,
        targetUnitY: dirFinalY,
        targetPathLength: finalSegmentLength,
      });
      segment.bars = parallelInfo.bars.length > 0 ? parallelInfo.bars : [];

      const innerOffset = parallelInfo.innerOffset;
      const canTrim =
        innerOffset !== null &&
        innerOffset > 0.2 &&
        innerOffset * 2 < length - 0.2;

      if (canTrim) {
        const trimmedStart =
          firstSegmentLength > innerOffset * 2
            ? {
                x: startPoint.x + dirFirstX * innerOffset,
                y: startPoint.y + dirFirstY * innerOffset,
              }
            : null;
        const trimmedEnd =
          finalSegmentLength > innerOffset * 2
            ? {
                x: endPoint.x - dirFinalX * innerOffset,
                y: endPoint.y - dirFinalY * innerOffset,
              }
            : null;

        if (trimmedStart || trimmedEnd) {
          if (trimmedStart) {
            updatedWaypoints[0] = trimmedStart;
            renderStart = trimmedStart;
          }
          if (trimmedEnd) {
            updatedWaypoints[updatedWaypoints.length - 1] = trimmedEnd;
            renderEnd = trimmedEnd;
          }
          pathNeedsUpdate = true;
        }
      }
    }
  }

  // Keep render markers aligned with the (possibly) updated endpoints
  segment.renderStart = renderStart;
  segment.renderEnd = renderEnd;

  if (pathNeedsUpdate) {
    segment.path = buildCurvedPathFromWaypoints(updatedWaypoints, curveOptions);
    segment.debugWaypoints = updatedWaypoints;
  }
}

function computeEdgeSegments(
  edges: EdgeDescriptor[],
  positions: Record<string, NodePosition>,
  areaAnchorMembers?: Record<string, string[]>,
  areaRects?: Record<string, Rect>,
  detailNodeIds?: Set<string>,
  edgeScale = 1,
  nodeColumns?: Record<string, number>,
  nodeAreaMap?: Map<string, string>,
): EdgeSegment[] {
  const segments: EdgeSegment[] = [];

  // Build spatial index for obstacle-aware routing (nodes + process areas)
  // Detail nodes are excluded - they render above edges and shouldn't affect routing
  const obstacleAreaRects: Record<string, ObstacleRect> | undefined = areaRects
    ? Object.fromEntries(
        Object.entries(areaRects).map(([id, rect]) => [
          id,
          { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        ]),
      )
    : undefined;
  const spatialIndex = buildSpatialIndex(positions, obstacleAreaRects, detailNodeIds);
  const nodeRectsForCollision: Array<{ id: string; rect: ObstacleRect }> = Object.entries(
    positions,
  )
    .filter(
      ([id]) =>
        !detailNodeIds?.has(id) &&
        !id.endsWith('::detail') &&
        !id.endsWith('::anchor'),
  )
    .map(([id, pos]) => {
      const halfW = pos.width / 2;
      const halfH = pos.height / 2;
      return {
        id,
        rect: {
          left: pos.centerX - halfW,
          right: pos.centerX + halfW,
          top: pos.centerY - halfH,
          bottom: pos.centerY + halfH,
        },
      };
    });

  const columnHasBlockingNode = (
    column: number,
    sourceId: string,
    targetId: string,
    positionsMap: Record<string, NodePosition>,
  ) => {
    if (!nodeColumns) return false;
    const sourcePos = positionsMap[sourceId];
    const targetPos = positionsMap[targetId];
    if (!sourcePos || !targetPos) return false;

    // Compute the actual attachment points (center of top/bottom edge)
    const sourceIsAbove = sourcePos.centerY < targetPos.centerY;
    const startPoint: Point2D = {
      x: sourcePos.centerX,
      y: sourceIsAbove ? sourcePos.centerY + sourcePos.height / 2 : sourcePos.centerY - sourcePos.height / 2,
    };
    const endPoint: Point2D = {
      x: targetPos.centerX,
      y: sourceIsAbove ? targetPos.centerY - targetPos.height / 2 : targetPos.centerY + targetPos.height / 2,
    };

    for (const [nodeId, col] of Object.entries(nodeColumns)) {
      if (col !== column) continue;
      if (nodeId === sourceId || nodeId === targetId) continue;
      const pos = positionsMap[nodeId];
      if (!pos) continue;
      if (detailNodeIds?.has(nodeId) || nodeId.endsWith('::detail') || nodeId.endsWith('::anchor')) continue;

      // Compute node's bounding box with OBSTACLE_PADDING to match spatialIndex
      const halfW = pos.width / 2 + OBSTACLE_PADDING;
      const halfH = pos.height / 2 + OBSTACLE_PADDING;
      const nodeRect: ObstacleRect = {
        left: pos.centerX - halfW,
        right: pos.centerX + halfW,
        top: pos.centerY - halfH,
        bottom: pos.centerY + halfH,
      };

      if (segmentIntersectsRect(startPoint, endPoint, nodeRect)) {
        return true;
      }
    }
    return false;
  };

  const rowHasBlockingNode = (
    sourceId: string,
    targetId: string,
    positionsMap: Record<string, NodePosition>,
  ) => {
    const sourcePos = positionsMap[sourceId];
    const targetPos = positionsMap[targetId];
    if (!sourcePos || !targetPos) return false;

    // Compute the actual attachment points (center of left/right edge)
    const sourceIsLeft = sourcePos.centerX < targetPos.centerX;
    const startPoint: Point2D = {
      x: sourceIsLeft ? sourcePos.centerX + sourcePos.width / 2 : sourcePos.centerX - sourcePos.width / 2,
      y: sourcePos.centerY,
    };
    const endPoint: Point2D = {
      x: sourceIsLeft ? targetPos.centerX - targetPos.width / 2 : targetPos.centerX + targetPos.width / 2,
      y: targetPos.centerY,
    };

    for (const [nodeId, pos] of Object.entries(positionsMap)) {
      if (nodeId === sourceId || nodeId === targetId) continue;
      if (detailNodeIds?.has(nodeId) || nodeId.endsWith('::detail') || nodeId.endsWith('::anchor')) continue;

      // Compute node's bounding box with OBSTACLE_PADDING to match spatialIndex
      const halfW = pos.width / 2 + OBSTACLE_PADDING;
      const halfH = pos.height / 2 + OBSTACLE_PADDING;
      const nodeRect: ObstacleRect = {
        left: pos.centerX - halfW,
        right: pos.centerX + halfW,
        top: pos.centerY - halfH,
        bottom: pos.centerY + halfH,
      };

      if (segmentIntersectsRect(startPoint, endPoint, nodeRect)) {
        return true;
      }
    }
    return false;
  };

  // Check for blocking nodes based on actual X-position (not logical column index)
  // Uses actual line segment intersection to match routeCrossesObstacles behavior
  const columnHasBlockingNodeByPosition = (
    sourceId: string,
    targetId: string,
    positionsMap: Record<string, NodePosition>,
  ) => {
    const sourcePos = positionsMap[sourceId];
    const targetPos = positionsMap[targetId];
    if (!sourcePos || !targetPos) return false;

    // Compute the actual attachment points (center of top/bottom edge)
    const sourceIsAbove = sourcePos.centerY < targetPos.centerY;
    const startPoint: Point2D = {
      x: sourcePos.centerX,
      y: sourceIsAbove ? sourcePos.centerY + sourcePos.height / 2 : sourcePos.centerY - sourcePos.height / 2,
    };
    const endPoint: Point2D = {
      x: targetPos.centerX,
      y: sourceIsAbove ? targetPos.centerY - targetPos.height / 2 : targetPos.centerY + targetPos.height / 2,
    };

    // Check each node for intersection with the line segment
    for (const [nodeId, pos] of Object.entries(positionsMap)) {
      if (nodeId === sourceId || nodeId === targetId) continue;
      if (detailNodeIds?.has(nodeId) || nodeId.endsWith('::detail') || nodeId.endsWith('::anchor')) continue;

      // Compute node's bounding box with OBSTACLE_PADDING to match spatialIndex
      const halfW = pos.width / 2 + OBSTACLE_PADDING;
      const halfH = pos.height / 2 + OBSTACLE_PADDING;
      const nodeRect: ObstacleRect = {
        left: pos.centerX - halfW,
        right: pos.centerX + halfW,
        top: pos.centerY - halfH,
        bottom: pos.centerY + halfH,
      };

      // Use the same intersection check as routeCrossesObstacles
      if (segmentIntersectsRect(startPoint, endPoint, nodeRect)) {
        return true;
      }
    }
    return false;
  };

  // ============================================================
  // PASS 1: Compute all routes FIRST (before building attachment tracker)
  // This allows us to group edges by their ACTUAL route sides, not predicted sides
  // ============================================================
  const edgeRoutes = new Map<string, RouteCandidate>();
  const edgeMetadata = new Map<
    string,
    {
      treatAsStraight: boolean;
      isAreaDetailEdge: boolean;
      straightSlots?: { sourceSlot: AttachmentSlot; targetSlot: AttachmentSlot };
    }
  >();

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

    const centerDx = targetCenter.x - sourceCenter.x;
    const centerDy = targetCenter.y - sourceCenter.y;
    let treatAsStraight = isAreaDetailEdge ? false : shouldRenderStraightSegment(centerDx, centerDy);
    let forcedStraightSlots: { sourceSlot: AttachmentSlot; targetSlot: AttachmentSlot } | null = null;

    // STEP 1: force straight edges for same column/row with clear path
    const sameColumnByIndex =
      nodeColumns &&
      nodeColumns[edge.from] !== undefined &&
      nodeColumns[edge.to] !== undefined &&
      nodeColumns[edge.from] === nodeColumns[edge.to];
    // Also check by actual X-position alignment
    const sameColumnByPosition = Math.abs(sourceCenter.x - targetCenter.x) <= COLUMN_ALIGNMENT_TOLERANCE;
    const sameRow = Math.abs(sourceCenter.y - targetCenter.y) <= ROW_ALIGNMENT_TOLERANCE;

    if (!isAreaDetailEdge) {
      // Check same column: either by logical index OR by position alignment
      const sameColumnNoBlocker =
        (sameColumnByIndex && !columnHasBlockingNode(nodeColumns![edge.from]!, edge.from, edge.to, positions)) ||
        (sameColumnByPosition && !columnHasBlockingNodeByPosition(edge.from, edge.to, positions));
      if (sameColumnNoBlocker) {
        treatAsStraight = true;
        const sourceSlot: AttachmentSlot =
          targetCenter.y >= sourceCenter.y
            ? { side: 'bottom', slot: 'center' }
            : { side: 'top', slot: 'center' };
        const targetSlot: AttachmentSlot =
          targetCenter.y >= sourceCenter.y
            ? { side: 'top', slot: 'center' }
            : { side: 'bottom', slot: 'center' };
        forcedStraightSlots = { sourceSlot, targetSlot };
        startPoint = getAttachmentPoint(source, sourceSlot);
        collisionPoint = getAttachmentPoint(target, targetSlot);
      } else if (
        sameRow &&
        !rowHasBlockingNode(edge.from, edge.to, positions)
      ) {
        treatAsStraight = true;
        const sourceSlot: AttachmentSlot =
          targetCenter.x >= sourceCenter.x
            ? { side: 'right', slot: 'center' }
            : { side: 'left', slot: 'center' };
        const targetSlot: AttachmentSlot =
          targetCenter.x >= sourceCenter.x
            ? { side: 'left', slot: 'center' }
            : { side: 'right', slot: 'center' };
        forcedStraightSlots = { sourceSlot, targetSlot };
        startPoint = getAttachmentPoint(source, sourceSlot);
        collisionPoint = getAttachmentPoint(target, targetSlot);
      }
    }

    // Inter-area special case: same column and no blocking nodes -> force vertical straight edge
    const sourceArea = nodeAreaMap?.get(edge.from);
    const targetArea = nodeAreaMap?.get(edge.to);
    const isInterAreaEdge = Boolean(sourceArea && targetArea && sourceArea !== targetArea);
    if (!isAreaDetailEdge && isInterAreaEdge) {
      const sourceCol = nodeColumns?.[edge.from];
      const targetCol = nodeColumns?.[edge.to];
      const sameColByIdx = sourceCol !== undefined && targetCol !== undefined && sourceCol === targetCol;
      const interAreaSameColumnNoBlocker =
        (sameColByIdx && !columnHasBlockingNode(sourceCol!, edge.from, edge.to, positions)) ||
        (sameColumnByPosition && !columnHasBlockingNodeByPosition(edge.from, edge.to, positions));
      if (interAreaSameColumnNoBlocker) {
        treatAsStraight = true;
        const sourceSlot: AttachmentSlot =
          targetCenter.y >= sourceCenter.y
            ? { side: 'bottom', slot: 'center' }
            : { side: 'top', slot: 'center' };
        const targetSlot: AttachmentSlot =
          targetCenter.y >= sourceCenter.y
            ? { side: 'top', slot: 'center' }
            : { side: 'bottom', slot: 'center' };
        forcedStraightSlots = { sourceSlot, targetSlot };
      }
    }

    // Check if a "straight" path would cross NODE obstacles
    if (treatAsStraight && !isAreaDetailEdge) {
      const straightPath = [startPoint, collisionPoint];
      const crossedObstacles = routeCrossesObstacles(straightPath, spatialIndex, [edge.from, edge.to]);
      const crossedNodes = crossedObstacles.filter((o) => o.type === 'node');
      if (crossedNodes.length > 0) {
        treatAsStraight = false;
      }
    }

    if (!treatAsStraight && !isAreaDetailEdge) {
      // Compute and store the route
      let bestRoute = findBestRoute(source, target, edge.from, edge.to, spatialIndex);

      // Fallback: inter-area, same column, no blockers → force straight if routing failed
      const fallbackSourceArea = nodeAreaMap?.get(edge.from);
      const fallbackTargetArea = nodeAreaMap?.get(edge.to);
      const fallbackSourceCol = nodeColumns?.[edge.from];
      const fallbackTargetCol = nodeColumns?.[edge.to];
      const fallbackSameColByIdx = fallbackSourceCol !== undefined && fallbackTargetCol !== undefined && fallbackSourceCol === fallbackTargetCol;
      const canForceStraight =
        fallbackSourceArea &&
        fallbackTargetArea &&
        fallbackSourceArea !== fallbackTargetArea &&
        ((fallbackSameColByIdx && !columnHasBlockingNode(fallbackSourceCol!, edge.from, edge.to, positions)) ||
         (sameColumnByPosition && !columnHasBlockingNodeByPosition(edge.from, edge.to, positions)));

      if ((!Number.isFinite(bestRoute.score) || bestRoute.score === Infinity) && canForceStraight) {
        const sourceSlot: AttachmentSlot =
          targetCenter.y >= sourceCenter.y
            ? { side: 'bottom', slot: 'center' }
            : { side: 'top', slot: 'center' };
        const targetSlot: AttachmentSlot =
          targetCenter.y >= sourceCenter.y
            ? { side: 'top', slot: 'center' }
            : { side: 'bottom', slot: 'center' };
        const straightPath = [
          getAttachmentPoint(source, sourceSlot),
          getAttachmentPoint(target, targetSlot),
        ];
        const crossings = routeCrossesObstacles(straightPath, spatialIndex, [edge.from, edge.to]);
        if (!crossings.some((o) => o.type === 'node')) {
          bestRoute = {
            waypoints: straightPath,
            sourceExit: sourceSlot.side,
            targetEntry: targetSlot.side,
            score: 0,
          };
          treatAsStraight = true;
          forcedStraightSlots = { sourceSlot, targetSlot };
        }
      }

      edgeRoutes.set(edge.id, bestRoute);
      edgeMetadata.set(edge.id, { treatAsStraight: treatAsStraight, isAreaDetailEdge: false, straightSlots: forcedStraightSlots ?? undefined });
    } else if (treatAsStraight && !isAreaDetailEdge) {
      // For straight edges, create a synthetic route to track attachment sides
      const straightSlots = forcedStraightSlots ?? chooseStraightEdgeSlots(source, target);
      if (straightSlots) {
        const syntheticRoute: RouteCandidate = {
          waypoints: [
            getAttachmentPoint(source, straightSlots.sourceSlot),
            getAttachmentPoint(target, straightSlots.targetSlot),
          ],
          sourceExit: straightSlots.sourceSlot.side,
          targetEntry: straightSlots.targetSlot.side,
          score: 0,
        };
        edgeRoutes.set(edge.id, syntheticRoute);
        edgeMetadata.set(edge.id, {
          treatAsStraight: true,
          isAreaDetailEdge: false,
          straightSlots,
        });
      } else {
        // Fallback for straight edges without good slots
        const sourceSide = determineNodeSide(startPoint, sourceCenter, source.width, source.height);
        const targetSide = determineNodeSide(
          collisionPoint,
          targetCenter,
          target.width,
          target.height,
        );
        const syntheticRoute: RouteCandidate = {
          waypoints: [startPoint, collisionPoint],
          sourceExit: sourceSide,
          targetEntry: targetSide,
          score: 0,
        };
        edgeRoutes.set(edge.id, syntheticRoute);
        edgeMetadata.set(edge.id, { treatAsStraight: true, isAreaDetailEdge: false });
      }
    } else {
      // Area detail edge - use predicted sides
      const sourceSide = predictAttachmentSide(sourceCenter, targetCenter, true);
      const targetSide = predictAttachmentSide(sourceCenter, targetCenter, false);
      const syntheticRoute: RouteCandidate = {
        waypoints: [startPoint, collisionPoint],
        sourceExit: sourceSide,
        targetEntry: targetSide,
        score: 0,
      };
      edgeRoutes.set(edge.id, syntheticRoute);
      edgeMetadata.set(edge.id, { treatAsStraight: false, isAreaDetailEdge: true });
    }
  });

  // ============================================================
  // PASS 2: Build attachment tracker from ACTUAL routes
  // ============================================================
  const attachmentTracker = buildAttachmentTrackerFromRoutes(edges, edgeRoutes);

  // ============================================================
  // PASS 3: Compute port constraints
  // - Single edge on side → center
  // - Straight edges → same port at both ends
  // ============================================================
  const portConstraints = computePortConstraints(edges, edgeRoutes, attachmentTracker);

  // ============================================================
  // PASS 4: Assign ports and build edge segments
  // ============================================================
  edges.forEach((edge) => {
    const source = positions[edge.from];
    const target = positions[edge.to];
    if (!source || !target) return;

    const metadata = edgeMetadata.get(edge.id);
    const bestRoute = edgeRoutes.get(edge.id);
    if (!metadata || !bestRoute) return;

    const { treatAsStraight, isAreaDetailEdge, straightSlots } = metadata;
    const sourceCenter: Point2D = { x: source.centerX, y: source.centerY };
    const targetCenter: Point2D = { x: target.centerX, y: target.centerY };

    let startPoint: Point2D;
    let collisionPoint: Point2D;

    if (isAreaDetailEdge) {
      // Handle area detail edges as before
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
    } else if (treatAsStraight) {
      // Handle straight edges
      if (straightSlots) {
        startPoint = getAttachmentPoint(source, straightSlots.sourceSlot);
        collisionPoint = getAttachmentPoint(target, straightSlots.targetSlot);
      } else {
        // Fallback
        const sourceSide = bestRoute.sourceExit;
        const targetSide = bestRoute.targetEntry;
        const sourceSlotValue: HorizontalSlot | VerticalSlot =
          sourceSide === 'top' || sourceSide === 'bottom' ? 'center' : 'top';
        const targetSlotValue: HorizontalSlot | VerticalSlot =
          targetSide === 'top' || targetSide === 'bottom' ? 'center' : 'top';
        startPoint = getAttachmentPoint(source, { side: sourceSide, slot: sourceSlotValue });
        collisionPoint = getAttachmentPoint(target, { side: targetSide, slot: targetSlotValue });
      }
    } else {
      // Handle routed (bent) edges - assign slots using route info
      const sourceSide = bestRoute.sourceExit;
      const targetSide = bestRoute.targetEntry;

      const sourceKey = `${edge.from}-${sourceSide}`;
      const targetKey = `${edge.to}-${targetSide}`;

      // Get ALL edges on each side (both incoming and outgoing)
      // This ensures incoming/outgoing edges don't share the same port
      const allSourceEdges = attachmentTracker.allAttachments.get(sourceKey) ?? [];
      const allTargetEdges = attachmentTracker.allAttachments.get(targetKey) ?? [];

      // Assign ports using constraint-based system for ALL edge types
      // - Respects hard constraints (single edge → center, straight → same port)
      // - Optimizes unconstrained edges by other endpoint position
      const sourceSlotValue = assignPort(
        sourceSide,
        edge,
        allSourceEdges,
        portConstraints,
        positions,
        true,
      );
      const targetSlotValue = assignPort(
        targetSide,
        edge,
        allTargetEdges,
        portConstraints,
        positions,
        false,
      );

      const sourceSlot: AttachmentSlot = { side: sourceSide, slot: sourceSlotValue };
      const targetSlot: AttachmentSlot = { side: targetSide, slot: targetSlotValue };

      // Get attachment points using discrete slots
      startPoint = getAttachmentPoint(source, sourceSlot);
      collisionPoint = getAttachmentPoint(target, targetSlot);
    }

    // Store the best route waypoints for multi-segment paths
    let routeWaypoints: Point2D[] | null = null;

    if (!treatAsStraight && !isAreaDetailEdge) {
      // Build route waypoints based on the best route shape
      if (bestRoute.waypoints.length === 2) {
        // Straight line
        routeWaypoints = [startPoint, collisionPoint];
      } else if (bestRoute.waypoints.length === 3) {
        // L-shape: recalculate corner based on new attachment points
        const isHorizontalFirst = isHorizontalSide(bestRoute.sourceExit);
        const corner = isHorizontalFirst
          ? { x: collisionPoint.x, y: startPoint.y }
          : { x: startPoint.x, y: collisionPoint.y };
        routeWaypoints = [startPoint, corner, collisionPoint];
      } else {
        // More complex routes: use original waypoints but update start/end
        routeWaypoints = [startPoint, ...bestRoute.waypoints.slice(1, -1), collisionPoint];
      }
    }

    let startX = startPoint.x;
    let startY = startPoint.y;
    const collisionX = collisionPoint.x;
    const collisionY = collisionPoint.y;

    // Calculate total path length (direct distance, used for sizing)
    const toCollisionDx = collisionX - startX;
    const toCollisionDy = collisionY - startY;
    const toCollisionLength = Math.hypot(toCollisionDx, toCollisionDy);
    if (!Number.isFinite(toCollisionLength) || toCollisionLength < 1) {
      return;
    }

    // For routed edges, calculate the ACTUAL final segment direction
    // This is crucial for placing arrow heads and bars at the correct angle
    let finalSegmentDx = toCollisionDx;
    let finalSegmentDy = toCollisionDy;
    let finalSegmentLength = toCollisionLength;
    let firstSegmentDx = toCollisionDx;
    let firstSegmentDy = toCollisionDy;
    let firstSegmentLength = toCollisionLength;

    if (routeWaypoints && routeWaypoints.length >= 3) {
      // Final segment: from second-to-last waypoint to collision point (target)
      const secondToLast = routeWaypoints[routeWaypoints.length - 2];
      finalSegmentDx = collisionX - secondToLast.x;
      finalSegmentDy = collisionY - secondToLast.y;
      finalSegmentLength = Math.hypot(finalSegmentDx, finalSegmentDy);
      if (!Number.isFinite(finalSegmentLength) || finalSegmentLength < 1) {
        finalSegmentDx = toCollisionDx;
        finalSegmentDy = toCollisionDy;
        finalSegmentLength = toCollisionLength;
      }

      // First segment: from start point to second waypoint (first corner)
      const secondWaypoint = routeWaypoints[1];
      firstSegmentDx = secondWaypoint.x - startX;
      firstSegmentDy = secondWaypoint.y - startY;
      firstSegmentLength = Math.hypot(firstSegmentDx, firstSegmentDy);
      if (!Number.isFinite(firstSegmentLength) || firstSegmentLength < 1) {
        firstSegmentDx = toCollisionDx;
        firstSegmentDy = toCollisionDy;
        firstSegmentLength = toCollisionLength;
      }
    }

    // Normalized direction vectors for the actual segments
    const dirFinalX = finalSegmentDx / finalSegmentLength;
    const dirFinalY = finalSegmentDy / finalSegmentLength;
    const dirFirstX = firstSegmentDx / firstSegmentLength;
    const dirFirstY = firstSegmentDy / firstSegmentLength;

    let endX = collisionX;
    let endY = collisionY;
    let dependentBase: Point2D | null = null;
    let dependentTip: Point2D | null = null;

    // Calculate perpendicular normals based on actual segment directions
    // Source normal: perpendicular to the first segment direction (outward from source)
    const sourceNormal: Point2D = { x: -dirFirstX, y: -dirFirstY };
    // Target normal: perpendicular to the final segment direction (inward to target)
    const targetNormal: Point2D = { x: dirFinalX, y: dirFinalY };

    if (edge.relation === 'D') {
      // Use final segment length for sizing, but position along actual final segment direction
      const rawCap = Math.min(
        Math.max(12 * edgeScale, finalSegmentLength * 0.35),
        24 * edgeScale,
      );
      const maxAvailable = Math.max(finalSegmentLength - 8 * edgeScale, 0);
      const capLength = Math.min(rawCap, maxAvailable);
      if (capLength > 1) {
        endX = collisionX - dirFinalX * capLength;
        endY = collisionY - dirFinalY * capLength;
        dependentBase = { x: endX, y: endY };
        dependentTip = { x: collisionX, y: collisionY };
      }
    }

    let arrowPath: string | null = null;

    if (edge.relation === 'I') {
      // Use final segment length to size the arrow appropriately for the actual approach distance
      const maxApproach = Math.max(finalSegmentLength - 4 * edgeScale, 0);
      const baseArrowLength = Math.min(
        Math.max(18, finalSegmentLength * 0.45),
        maxApproach,
      );
      const arrowLength = Math.min(baseArrowLength * edgeScale, maxApproach);
      if (arrowLength > 8) {
        // Position arrow along the actual final segment direction
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
    let pathSegmentsForCollision: PathSegment[] = [];

    if (edge.relation === 'P') {
      // For routed edges, use actual segment directions for proper bar positioning
      parallelInfo = buildParallelBars({
        startX,
        startY,
        endX,
        endY,
        unitX: dirFirstX,  // Use first segment direction for source-side bars
        unitY: dirFirstY,
        pathLength: firstSegmentLength,
        edgeScale,
        sourceNormal,
        targetNormal,
        // Pass final segment info for target-side bar positioning
        targetUnitX: dirFinalX,
        targetUnitY: dirFinalY,
        targetPathLength: finalSegmentLength,
      });
      const innerOffset = parallelInfo.innerOffset;
      if (
        innerOffset !== null &&
        innerOffset > 0.2 &&
        innerOffset * 2 < length - 0.2
      ) {
        // Use actual segment directions for truncation
        const truncatedStartX = startX + dirFirstX * innerOffset;
        const truncatedStartY = startY + dirFirstY * innerOffset;
        const truncatedEndX = endX - dirFinalX * innerOffset;
        const truncatedEndY = endY - dirFinalY * innerOffset;
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
    } else if (routeWaypoints && routeWaypoints.length > 2) {
      // Multi-segment route: use smooth curved path through waypoints
      // For parallel edges, we need to handle the truncation for bars
      if (truncatedForParallel && routeWaypoints.length >= 2) {
        // Truncate the first and last segments for the parallel bars
        const innerOffset = parallelInfo?.innerOffset ?? 0;
        if (innerOffset > 0) {
          // Adjust first waypoint
          const firstDir = {
            x: routeWaypoints[1].x - routeWaypoints[0].x,
            y: routeWaypoints[1].y - routeWaypoints[0].y,
          };
          const firstLen = Math.hypot(firstDir.x, firstDir.y);
          if (firstLen > innerOffset * 2) {
            routeWaypoints[0] = {
              x: routeWaypoints[0].x + (firstDir.x / firstLen) * innerOffset,
              y: routeWaypoints[0].y + (firstDir.y / firstLen) * innerOffset,
            };
          }
          // Adjust last waypoint
          const lastIdx = routeWaypoints.length - 1;
          const lastDir = {
            x: routeWaypoints[lastIdx - 1].x - routeWaypoints[lastIdx].x,
            y: routeWaypoints[lastIdx - 1].y - routeWaypoints[lastIdx].y,
          };
          const lastLen = Math.hypot(lastDir.x, lastDir.y);
          if (lastLen > innerOffset * 2) {
            routeWaypoints[lastIdx] = {
              x: routeWaypoints[lastIdx].x + (lastDir.x / lastLen) * innerOffset,
              y: routeWaypoints[lastIdx].y + (lastDir.y / lastLen) * innerOffset,
            };
          }
        }
      }
      path = buildCurvedPathFromWaypoints(routeWaypoints);
      pathSegmentsForCollision = buildPathSegmentsFromWaypoints(routeWaypoints);
    } else {
      // Simple 2-point route or straight edge: use original curved path logic
      const pathSegments: string[] = [`M ${sourceCenter.x} ${sourceCenter.y}`];
      if (Math.abs(sourceCenter.x - startX) > 1e-2 || Math.abs(sourceCenter.y - startY) > 1e-2) {
        pathSegments.push(`L ${startX} ${startY}`);
      }
      if (truncatedForParallel) {
        pathSegments.push(`M ${curveStartX} ${curveStartY}`);
      }

      const simpleGeometry = describeSimplePathGeometry({
        startX: curveStartX,
        startY: curveStartY,
        endX: curveEndX,
        endY: curveEndY,
        dx: curveDx,
        dy: curveDy,
        unitX: curveUnitX,
        unitY: curveUnitY,
      });
      const curvePath = simpleGeometry.path;
      const curveWithoutMove = curvePath.replace(
        /^M\s*[-+]?[\d.]+(?:e[-+]?\d+)?\s+[-+]?[\d.]+(?:e[-+]?\d+)?\s*/i,
        '',
      );
      if (curveWithoutMove.trim().length > 0) {
        pathSegments.push(curveWithoutMove.trimStart());
      }

      path = pathSegments.join(' ');

      // Collision geometry mirrors the rendered path (including the optional lead-in line)
      if (Math.abs(sourceCenter.x - startX) > 1e-2 || Math.abs(sourceCenter.y - startY) > 1e-2) {
        const leadLen = Math.hypot(startX - sourceCenter.x, startY - sourceCenter.y);
        if (leadLen > 0.5) {
          pathSegmentsForCollision.push({
            type: 'line',
            from: { x: sourceCenter.x, y: sourceCenter.y },
            to: { x: startX, y: startY },
            length: leadLen,
          });
        }
      }
      pathSegmentsForCollision.push(...simpleGeometry.segments);
    }

    const segment: EdgeSegment = {
      id: edge.id,
      relation: edge.relation,
      path,
      color: edge.color,
      debugWaypoints: routeWaypoints ? [...routeWaypoints] : undefined,
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
        normalX: targetNormal?.x ?? dirFinalX,
        normalY: targetNormal?.y ?? dirFinalY,
        effectiveLength: finalSegmentLength,
        edgeScale,
      });
      if (cap) {
        segment.capPath = cap;
      }
    } else if (arrowPath) {
      segment.arrowPath = arrowPath;
    }

    // Post-routing validation: flag edges whose rendered path intersects any node
    if (pathSegmentsForCollision.length > 0) {
      const firstSeg = pathSegmentsForCollision[0];
      const lastSeg = pathSegmentsForCollision[pathSegmentsForCollision.length - 1];
      segment.renderStart = firstSeg.type === 'line' ? firstSeg.from : firstSeg.from;
      segment.renderEnd = lastSeg.type === 'line' ? lastSeg.to : lastSeg.to;

      const sampling = samplePathSegments(pathSegmentsForCollision);
      const nodeCrossing = detectNodeCrossings(
        sampling.samples,
        sampling.totalLength,
        nodeRectsForCollision,
        edge.from,
        edge.to,
      );
      segment.crossesNode = nodeCrossing.crosses;
      if (nodeCrossing.points.length > 0) {
        segment.crossingPoints = nodeCrossing.points;
      }
    }

    // POST-PROCESSING: Force straight edges for same-column nodes with clear path
    // This runs AFTER all routing, overriding bent edges when a straight line is valid
    if (!isAreaDetailEdge && edge.relation !== 'A') {
      const sameColumnByPos = Math.abs(sourceCenter.x - targetCenter.x) <= COLUMN_ALIGNMENT_TOLERANCE;
      const sameRowByPos = Math.abs(sourceCenter.y - targetCenter.y) <= ROW_ALIGNMENT_TOLERANCE;

      if (sameColumnByPos || sameRowByPos) {
        // Compute straight line attachment points
        let straightStart: Point2D;
        let straightEnd: Point2D;

        if (sameColumnByPos) {
          // Vertical straight line
          const sourceIsAbove = sourceCenter.y < targetCenter.y;
          straightStart = {
            x: sourceCenter.x,
            y: sourceIsAbove ? sourceCenter.y + source.height / 2 : sourceCenter.y - source.height / 2,
          };
          straightEnd = {
            x: targetCenter.x,
            y: sourceIsAbove ? targetCenter.y - target.height / 2 : targetCenter.y + target.height / 2,
          };
        } else {
          // Horizontal straight line
          const sourceIsLeft = sourceCenter.x < targetCenter.x;
          straightStart = {
            x: sourceIsLeft ? sourceCenter.x + source.width / 2 : sourceCenter.x - source.width / 2,
            y: sourceCenter.y,
          };
          straightEnd = {
            x: sourceIsLeft ? targetCenter.x - target.width / 2 : targetCenter.x + target.width / 2,
            y: targetCenter.y,
          };
        }

        // Check if the straight path crosses any nodes
        let straightPathClear = true;
        for (const nodeRect of nodeRectsForCollision) {
          if (nodeRect.id === edge.from || nodeRect.id === edge.to) continue;
          if (segmentIntersectsRect(straightStart, straightEnd, nodeRect.rect)) {
            straightPathClear = false;
            break;
          }
        }

        if (straightPathClear) {
          // Replace path with straight line
          segment.path = `M ${straightStart.x} ${straightStart.y} L ${straightEnd.x} ${straightEnd.y}`;
          segment.debugWaypoints = [straightStart, straightEnd];
          segment.crossesNode = false;
          segment.crossingPoints = undefined;
          // Recalculate decorations for the new path
          recalculateEdgeDecorations(segment, [straightStart, straightEnd], edge.relation, edgeScale);
        }
      }
    }

    // POST-PROCESSING: Fix edges that cross nodes by trying alternative routes
    // Only apply to edges where source and target are at DIFFERENT heights (not same row)
    const notSameRow = Math.abs(sourceCenter.y - targetCenter.y) > ROW_ALIGNMENT_TOLERANCE;
    if (segment.crossesNode && !isAreaDetailEdge && routeWaypoints && routeWaypoints.length >= 3 && notSameRow) {
      // First, find which node the ORIGINAL path crosses
      let originalBlockingNode: { id: string; rect: ObstacleRect } | null = null;
      for (const nodeRect of nodeRectsForCollision) {
        if (nodeRect.id === edge.from || nodeRect.id === edge.to) continue;
        for (let i = 0; i < routeWaypoints.length - 1; i++) {
          if (segmentIntersectsRect(routeWaypoints[i], routeWaypoints[i + 1], nodeRect.rect)) {
            originalBlockingNode = nodeRect;
            break;
          }
        }
        if (originalBlockingNode) break;
      }

      const currentIsHorizontalFirst = isHorizontalSide(bestRoute.sourceExit);

      // STAGE 1: Try opposite L-shape direction
      let altStart: Point2D;
      let altEnd: Point2D;
      let altCorner: Point2D;

      if (currentIsHorizontalFirst) {
        // Current: horizontal-first → Try: vertical-first
        const exitSide: NodeSide = targetCenter.y > sourceCenter.y ? 'bottom' : 'top';
        const entrySide: NodeSide = targetCenter.x > sourceCenter.x ? 'left' : 'right';
        altStart = getAttachmentPointOnSide(source, exitSide, 0);
        altEnd = getAttachmentPointOnSide(target, entrySide, 0);
        altCorner = { x: altStart.x, y: altEnd.y };
      } else {
        // Current: vertical-first → Try: horizontal-first
        const exitSide: NodeSide = targetCenter.x > sourceCenter.x ? 'right' : 'left';
        const entrySide: NodeSide = targetCenter.y > sourceCenter.y ? 'top' : 'bottom';
        altStart = getAttachmentPointOnSide(source, exitSide, 0);
        altEnd = getAttachmentPointOnSide(target, entrySide, 0);
        altCorner = { x: altEnd.x, y: altStart.y };
      }

      const altWaypoints = [altStart, altCorner, altEnd];

      // Check if alternative L-shape is clear
      let altPathClear = true;
      for (const nodeRect of nodeRectsForCollision) {
        if (nodeRect.id === edge.from || nodeRect.id === edge.to) continue;
        if (segmentIntersectsRect(altStart, altCorner, nodeRect.rect) ||
            segmentIntersectsRect(altCorner, altEnd, nodeRect.rect)) {
          altPathClear = false;
          break;
        }
      }

      if (altPathClear) {
        // Stage 1 success: Use opposite L-shape
        segment.path = buildCurvedPathFromWaypoints(altWaypoints);
        segment.debugWaypoints = altWaypoints;
        segment.crossesNode = false;
        segment.crossingPoints = undefined;
        // Recalculate decorations for the new path
        recalculateEdgeDecorations(segment, altWaypoints, edge.relation, edgeScale);
      } else if (originalBlockingNode) {
        // STAGE 2: Create Z-shaped path (vertical → horizontal → vertical)
        // Try multiple port combinations and prefer unused ports
        const targetAbove = targetCenter.y < sourceCenter.y;

        // Source exits vertically toward target
        const sourceExitSide: NodeSide = targetAbove ? 'top' : 'bottom';
        // Target enters from opposite vertical side
        const targetEntrySide: NodeSide = targetAbove ? 'bottom' : 'top';

        // Count how many edges already use a given port (node + side)
        const countZPortUsage = (nodeId: string, side: NodeSide): number => {
          const key = `${nodeId}-${side}`;
          return (attachmentTracker.allAttachments.get(key) ?? []).length;
        };

        // Count crossings for a given waypoint path
        const countZCrossings = (waypoints: Point2D[]): number => {
          let crossings = 0;
          for (const nodeRect of nodeRectsForCollision) {
            if (nodeRect.id === edge.from || nodeRect.id === edge.to) continue;
            for (let i = 0; i < waypoints.length - 1; i++) {
              if (segmentIntersectsRect(waypoints[i], waypoints[i + 1], nodeRect.rect, -10)) {
                crossings++;
                break;
              }
            }
          }
          return crossings;
        };

        // Generate Z-shape waypoints with specific port slots
        const makeZShape = (sourceSlot: HorizontalSlot, targetSlot: HorizontalSlot): Point2D[] => {
          const zStart = getAttachmentPoint(source, { side: sourceExitSide, slot: sourceSlot });
          const zEnd = getAttachmentPoint(target, { side: targetEntrySide, slot: targetSlot });
          const midY = (zStart.y + zEnd.y) / 2;
          const corner1: Point2D = { x: zStart.x, y: midY };
          const corner2: Point2D = { x: zEnd.x, y: midY };
          return [zStart, corner1, corner2, zEnd];
        };

        // Collect candidates: 3 source slots × 3 target slots = 9 candidates
        const zSlots: HorizontalSlot[] = ['left', 'center', 'right'];
        const zCandidates: Array<{ waypoints: Point2D[]; crossings: number; sharedPorts: number }> = [];

        for (const sourceSlot of zSlots) {
          for (const targetSlot of zSlots) {
            const waypoints = makeZShape(sourceSlot, targetSlot);
            const crossings = countZCrossings(waypoints);
            const sourceUsage = countZPortUsage(edge.from, sourceExitSide);
            const targetUsage = countZPortUsage(edge.to, targetEntrySide);
            const sharedPorts = (sourceUsage > 0 ? 1 : 0) + (targetUsage > 0 ? 1 : 0);
            zCandidates.push({ waypoints, crossings, sharedPorts });
          }
        }

        // Sort by: 1) fewest crossings, 2) fewest shared ports
        zCandidates.sort((a, b) => {
          if (a.crossings !== b.crossings) return a.crossings - b.crossings;
          return a.sharedPorts - b.sharedPorts;
        });

        const bestZ = zCandidates[0];
        if (bestZ) {
          segment.path = buildCurvedPathFromWaypoints(bestZ.waypoints, FLOWING_S_CURVE);
          segment.debugWaypoints = bestZ.waypoints;
          segment.crossesNode = bestZ.crossings > 0;
          segment.crossingPoints = undefined;
          // Recalculate decorations for the new path (preserve flowing radius)
          recalculateEdgeDecorations(segment, bestZ.waypoints, edge.relation, edgeScale, FLOWING_S_CURVE);
        }
      }
    }

    // POST-PROCESSING: U-shape for same-row edges that cross nodes
    const isSameRow = Math.abs(sourceCenter.y - targetCenter.y) <= ROW_ALIGNMENT_TOLERANCE;
    if (segment.crossesNode && !isAreaDetailEdge && isSameRow) {
      // Count crossings for a given waypoint path
      // Use negative shrinkAmount (-10) to EXPAND node rects and detect near-misses
      const countCrossings = (waypoints: Point2D[]): number => {
        let crossings = 0;
        for (const nodeRect of nodeRectsForCollision) {
          if (nodeRect.id === edge.from || nodeRect.id === edge.to) continue;
          for (let i = 0; i < waypoints.length - 1; i++) {
            // Expand rects by 10px to prefer paths with more clearance
            if (segmentIntersectsRect(waypoints[i], waypoints[i + 1], nodeRect.rect, -10)) {
              crossings++;
              break; // Count each node only once
            }
          }
        }
        return crossings;
      };

      // Generate U-shape waypoints with specific port slots
      const makeUShape = (
        direction: 'up' | 'down',
        height: number,
        sourceSlot: HorizontalSlot,
        targetSlot: HorizontalSlot,
      ): Point2D[] => {
        const side: NodeSide = direction === 'up' ? 'top' : 'bottom';
        const start = getAttachmentPoint(source, { side, slot: sourceSlot });
        const end = getAttachmentPoint(target, { side, slot: targetSlot });
        const y = direction === 'up'
          ? Math.min(start.y, end.y) - height
          : Math.max(start.y, end.y) + height;
        return [start, { x: start.x, y }, { x: end.x, y }, end];
      };

      // Count how many edges already use a given port (node + side)
      const countPortUsage = (nodeId: string, side: NodeSide): number => {
        const key = `${nodeId}-${side}`;
        return (attachmentTracker.allAttachments.get(key) ?? []).length;
      };

      // Collect ALL candidates: 2 directions × 2 heights × 3 source slots × 3 target slots = 36 candidates
      const uHeights = [40, 100];
      const slots: HorizontalSlot[] = ['left', 'center', 'right'];
      const candidates: Array<{ waypoints: Point2D[]; crossings: number; height: number; sharedPorts: number; direction: 'up' | 'down' }> = [];

      for (const direction of ['up', 'down'] as const) {
        for (const height of uHeights) {
          for (const sourceSlot of slots) {
            for (const targetSlot of slots) {
              const waypoints = makeUShape(direction, height, sourceSlot, targetSlot);
              const crossings = countCrossings(waypoints);
              // Count shared ports: 0 = both unused, 1 = one shared, 2 = both shared
              const side: NodeSide = direction === 'up' ? 'top' : 'bottom';
              const sourceUsage = countPortUsage(edge.from, side);
              const targetUsage = countPortUsage(edge.to, side);
              const sharedPorts = (sourceUsage > 0 ? 1 : 0) + (targetUsage > 0 ? 1 : 0);
              candidates.push({ waypoints, crossings, height, sharedPorts, direction });
            }
          }
        }
      }

      // Sort by: 1) fewest crossings, 2) fewest shared ports, 3) smallest height
      candidates.sort((a, b) => {
        if (a.crossings !== b.crossings) return a.crossings - b.crossings;
        if (a.sharedPorts !== b.sharedPorts) return a.sharedPorts - b.sharedPorts;
        return a.height - b.height;
      });

      const best = candidates[0];
      if (best) {
        segment.path = buildCurvedPathFromWaypoints(best.waypoints);
        segment.debugWaypoints = best.waypoints;
        segment.crossesNode = best.crossings > 0;
        segment.crossingPoints = undefined;
        // Recalculate decorations for the new path
        recalculateEdgeDecorations(segment, best.waypoints, edge.relation, edgeScale);
      }
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

function describeSimplePathGeometry({
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
}): { path: string; segments: PathSegment[] } {
  const length = Math.hypot(dx, dy);
  const segments: PathSegment[] = [];

  if (!Number.isFinite(length) || length < 1) {
    const path = `M ${startX} ${startY} L ${endX} ${endY}`;
    segments.push({ type: 'line', from: { x: startX, y: startY }, to: { x: endX, y: endY }, length: 0 });
    return { path, segments };
  }

  if (shouldRenderStraightSegment(dx, dy, length)) {
    const path = `M ${startX} ${startY} L ${endX} ${endY}`;
    segments.push({
      type: 'line',
      from: { x: startX, y: startY },
      to: { x: endX, y: endY },
      length,
    });
    return { path, segments };
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const midpointX = (startX + endX) / 2;
  const midpointY = (startY + endY) / 2;

  let bendDirection: number;
  if (absDx >= absDy) {
    bendDirection = dy >= 0 ? 1 : -1;
  } else {
    bendDirection = dx <= 0 ? 1 : -1;
  }
  if (!Number.isFinite(bendDirection) || bendDirection === 0) {
    bendDirection = 1;
  }

  const baseCurve = length * 0.5;
  const maxCurve = Math.max(36, length * 0.65);
  const curveStrength = Math.min(Math.max(baseCurve, 18), maxCurve, length * 1.2);
  const perpX = -unitY * bendDirection;
  const perpY = unitX * bendDirection;

  const controlX = midpointX + perpX * curveStrength;
  const controlY = midpointY + perpY * curveStrength;

  const path = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
  const quadLength = Math.hypot(controlX - startX, controlY - startY) + Math.hypot(endX - controlX, endY - controlY);
  segments.push({
    type: 'quad',
    from: { x: startX, y: startY },
    control: { x: controlX, y: controlY },
    to: { x: endX, y: endY },
    length: quadLength,
  });

  return { path, segments };
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

  // Build a map of nodeId -> areaId for routing complexity evaluation
  const nodeAreaMap = new Map<string, string>();
  layers.forEach((layer) => {
    layer.areas.forEach((area) => {
      area.objectTypes.forEach((objectType) => {
        nodeAreaMap.set(objectType, area.id);
      });
    });
  });

  // Build a map of levelIndex -> areas at that level (for area crossing detection)
  const areasByLevel = new Map<number, Array<{ id: string; nodeIds: string[] }>>();
  layers.forEach((layer, layerIndex) => {
    const areasAtLevel: Array<{ id: string; nodeIds: string[] }> = [];
    layer.areas.forEach((area) => {
      if (area.objectTypes.length > 0) {
        areasAtLevel.push({ id: area.id, nodeIds: area.objectTypes });
      }
    });
    areasByLevel.set(layerIndex, areasAtLevel);
  });

  const evaluateCrossings = (columns: Record<string, number>) => {
    let total = 0;
    edges.forEach((edge) => {
      // Count intermediate node obstacles - high penalty (3.0 per node crossed)
      total += countIntermediateObstacles(edge, columns, nodeLevelIndex, nodesByLevelIndex) * 0.0;

      const sourceLevel = nodeLevelIndex.get(edge.from);
      const targetLevel = nodeLevelIndex.get(edge.to);
      const sourceCol = columns[edge.from];
      const targetCol = columns[edge.to];
      const sourceArea = nodeAreaMap.get(edge.from);
      const targetArea = nodeAreaMap.get(edge.to);

      if (
        sourceLevel !== undefined &&
        targetLevel !== undefined &&
        sourceCol !== undefined &&
        targetCol !== undefined &&
        sourceLevel !== targetLevel
      ) {
        const minCol = Math.min(sourceCol, targetCol);
        const maxCol = Math.max(sourceCol, targetCol);
        const minLevel = Math.min(sourceLevel, targetLevel);
        const maxLevel = Math.max(sourceLevel, targetLevel);

        // Check for AREA crossings at intermediate levels
        // This penalizes layouts where edges would have to route around process areas
        for (let level = minLevel + 1; level < maxLevel; level++) {
          const areasAtLevel = areasByLevel.get(level) ?? [];
          for (const area of areasAtLevel) {
            // Skip if this is the source or target's area
            if (area.id === sourceArea || area.id === targetArea) continue;

            // Compute the area's column span based on its nodes' current columns
            const areaCols = area.nodeIds
              .map((nodeId) => columns[nodeId])
              .filter((c): c is number => c !== undefined);
            if (areaCols.length === 0) continue;

            const areaMinCol = Math.min(...areaCols);
            const areaMaxCol = Math.max(...areaCols);

            // Check if the edge's column range overlaps with this area's column range
            // If so, the edge would have to cross through this area
            if (maxCol >= areaMinCol && minCol <= areaMaxCol) {
              // Calculate overlap extent - penalty scales with how much of area is crossed
              const overlapStart = Math.max(minCol, areaMinCol);
              const overlapEnd = Math.min(maxCol, areaMaxCol);
              const overlapExtent = overlapEnd - overlapStart + 1;

              // Base penalty of 1.0, plus 0.5 per column of overlap
              // Crossing more of an area = higher penalty
              total += 1.0 + overlapExtent * 0.5;
            }
          }
        }

        // Additional penalty for cross-area edges with blocking nodes
        if (sourceArea !== targetArea) {
          const colDiff = Math.abs(sourceCol - targetCol);
          let hasBlockingNode = false;
          for (let level = minLevel + 1; level < maxLevel; level++) {
            const nodesAtLevel = nodesByLevelIndex.get(level) ?? [];
            for (const nodeId of nodesAtLevel) {
              if (nodeId === edge.from || nodeId === edge.to) continue;
              const nodeCol = columns[nodeId];
              if (nodeCol !== undefined && nodeCol >= minCol && nodeCol <= maxCol) {
                hasBlockingNode = true;
                break;
              }
            }
            if (hasBlockingNode) break;
          }

          if (hasBlockingNode && colDiff > 0) {
            total += colDiff * 0.4;
          }
        }
      }
    });
    return total;
  };

  if (edges.length > 0) {
    // Helper function to run optimization from a given starting configuration
    const runOptimization = (
      startColumns: Record<string, number>,
    ): { columns: Record<string, number>; score: number } => {
      const testColumns = { ...startColumns };

      const levelOccupancy = new Map<number, Set<number>>();
      nodeLevelIndex.forEach((levelIndex, nodeId) => {
        const column = testColumns[nodeId];
        if (column === undefined) return;
        if (!levelOccupancy.has(levelIndex)) {
          levelOccupancy.set(levelIndex, new Set());
        }
        levelOccupancy.get(levelIndex)!.add(column);
      });

      let globalScore = evaluateCrossings(testColumns);
      const deltas = [0, -1, 1, -2, 2, -3, 3, -4, 4];

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
            const currentColumn = testColumns[nodeId];
            if (currentColumn === undefined) return;
            let bestColumn = currentColumn;
            let bestScore = globalScore;
            occupancy.delete(currentColumn);

            deltas.forEach((delta) => {
              const candidate = currentColumn + delta;
              if (candidate < 0) return;
              if (occupancy.has(candidate)) return;
              testColumns[nodeId] = candidate;
              occupancy.add(candidate);
              const candidateScore = evaluateCrossings(testColumns);
              occupancy.delete(candidate);
              testColumns[nodeId] = currentColumn;
              if (candidateScore + 1e-6 < bestScore) {
                bestScore = candidateScore;
                bestColumn = candidate;
              }
            });

            occupancy.add(currentColumn);

            if (bestColumn !== currentColumn) {
              occupancy.delete(currentColumn);
              occupancy.add(bestColumn);
              testColumns[nodeId] = bestColumn;
              globalScore = bestScore;
              improved = true;
            } else {
              testColumns[nodeId] = currentColumn;
            }
          });
        }
        if (!improved) break;
      }

      // Additional optimization: try swapping adjacent nodes within the same level
      for (let swapIteration = 0; swapIteration < 3; swapIteration += 1) {
        let swapImproved = false;
        for (let levelIndex = 0; levelIndex < levelOrder.length; levelIndex += 1) {
          const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
          if (nodesAtLevel.length < 2) continue;

          const sortedNodes = [...nodesAtLevel].sort(
            (a, b) => (testColumns[a] ?? 0) - (testColumns[b] ?? 0),
          );

          for (let i = 0; i < sortedNodes.length - 1; i += 1) {
            const nodeA = sortedNodes[i];
            const nodeB = sortedNodes[i + 1];
            const colA = testColumns[nodeA];
            const colB = testColumns[nodeB];

            if (colA === undefined || colB === undefined) continue;

            testColumns[nodeA] = colB;
            testColumns[nodeB] = colA;

            const swappedScore = evaluateCrossings(testColumns);

            if (swappedScore + 1e-6 < globalScore) {
              globalScore = swappedScore;
              swapImproved = true;
              sortedNodes[i] = nodeB;
              sortedNodes[i + 1] = nodeA;
            } else {
              testColumns[nodeA] = colA;
              testColumns[nodeB] = colB;
            }
          }
        }
        if (!swapImproved) break;
      }

      return { columns: testColumns, score: globalScore };
    };

    // Multi-start optimization: try different starting configurations
    const startingConfigs: Record<string, number>[] = [{ ...nodeColumns }];

    // Find max column to determine shift range
    const allColumns = Object.values(nodeColumns).filter(
      (v): v is number => v !== undefined,
    );
    const maxCol = allColumns.length > 0 ? Math.max(...allColumns) : 0;

    // Generate alternative starting configurations by shifting entire levels horizontally
    for (let levelIndex = 0; levelIndex < levelOrder.length; levelIndex += 1) {
      const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
      if (nodesAtLevel.length === 0) continue;

      // Try shifting all nodes at this level by various amounts
      for (let shift = -maxCol - 2; shift <= maxCol + 4; shift += 1) {
        if (shift === 0) continue;
        const config = { ...nodeColumns };
        let valid = true;

        nodesAtLevel.forEach((nodeId) => {
          const newCol = (config[nodeId] ?? 0) + shift;
          if (newCol < 0) valid = false;
          else config[nodeId] = newCol;
        });

        if (valid) startingConfigs.push(config);
      }
    }

    // Run optimization from each starting configuration and keep the best
    let bestResult = runOptimization(startingConfigs[0]);

    for (let i = 1; i < startingConfigs.length; i += 1) {
      const result = runOptimization(startingConfigs[i]);
      if (result.score < bestResult.score) {
        bestResult = result;
      }
    }

    // Apply the best result
    Object.assign(nodeColumns, bestResult.columns);

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

function ProcessAreaVisualizer({
  eventLogId,
  height = '100%',
  backendBaseUrl = DEFAULT_BACKEND,
  reloadSignal,
  title,
  topInset = 0,
  embedded = false,
  onControlsReady,
}: ProcessAreaVisualizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTotem, setRawTotem] = useState<TotemApiResponse | null>(null);
  const [internalReloadSignal, setInternalReloadSignal] = useState(0);
  const effectiveReloadSignal = reloadSignal ?? internalReloadSignal;
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
  // Canvas panning state (only active when auto-zoom is disabled)
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
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

  // Canvas panning handlers (only active when auto-zoom is disabled)
  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      if (autoZoomEnabled) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      e.preventDefault();
    },
    [autoZoomEnabled],
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning || !panStartRef.current) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      container.scrollLeft = panStartRef.current.scrollLeft - dx;
      container.scrollTop = panStartRef.current.scrollTop - dy;
    },
    [isPanning],
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  // Expose controls to parent component via callback
  useEffect(() => {
    if (!onControlsReady) return;
    onControlsReady({
      processAreaScale,
      onProcessAreaScaleChange: handleProcessAreaScaleChange,
      autoZoomEnabled,
      onAutoZoomToggle: () => {
        const next = !autoZoomEnabled;
        setAutoZoomEnabled(next);
        if (next) {
          setAutoZoomTrigger((value) => value + 1);
        }
      },
      minScale: MIN_PROCESS_AREA_SCALE,
      maxScale: MAX_PROCESS_AREA_SCALE,
      scaleStep: PROCESS_AREA_SCALE_STEP,
    });
  }, [onControlsReady, processAreaScale, handleProcessAreaScaleChange, autoZoomEnabled]);

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

  const layers = useMemo(() => (rawTotem ? buildLayers(rawTotem, true) : []), [rawTotem]);
  const levelCount = layers.length;
  const extraTopPadding = useMemo(() => {
    const deficit = Math.max(0, 4 - levelCount);
    return Math.min(180, deficit * 60); // push down when few levels; capped
  }, [levelCount]);
  const contentPaddingTop = 32 + resolvedTopInset + extraTopPadding;
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
  const violatingEdgeSegments = useMemo(
    () => edgeSegments.filter((segment) => segment.crossesNode),
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

    setLoading(true);
    setError(null);
    // Clear stale data so the legend/process areas reflect the new backend result as soon as it arrives
    setRawTotem(null);
    try {
      const token = localStorage.getItem('access_token');
      const endpoint = `${backendBaseUrl}/api/files/${eventLogId}/discover_mlpa/`;
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
      console.error('[ProcessAreaVisualizer] Failed to load Totem data', err);
      setError(err instanceof Error ? err.message : 'Failed to load Totem data');
      setRawTotem(null);
    } finally {
      setLoading(false);
    }
  }, [backendBaseUrl, eventLogId]);

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

        const payload: { dfg?: OcdfgGraph; all_nodes?: OcdfgNodeSummary[]; filter_error?: string; trace_variants?: OcdfgGraph['trace_variants'] } & Partial<OcdfgGraph> =
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

        const registerNodes = (payload?.all_nodes && payload.all_nodes.length > 0
          ? payload.all_nodes
          : allOcdfgNodes) as OcdfgNodeSummary[] | null;

        const enrichedGraph: OcdfgGraph =
          registerNodes && registerNodes.length > 0
            ? {
                ...graph,
                nodes: graph.nodes.map((node) => {
                  const registerNode = registerNodes.find((n) => n.id === node.id);
                  const mergedTypes = Array.from(
                    new Set([...(node.types ?? []), ...((registerNode?.types as string[]) ?? [])]),
                  );
                  return {
                    ...node,
                    types: mergedTypes,
                    object_type: node.object_type ?? registerNode?.object_type ?? null,
                    role: node.role ?? registerNode?.role ?? null,
                  };
                }),
                // Include trace variants from backend
                trace_variants: payload?.trace_variants,
              }
            : { ...graph, trace_variants: payload?.trace_variants };

        setDetailCache((prev) => ({
          ...prev,
          [areaId]: enrichedGraph,
        }));
        if (payload?.filter_error) {
          setDetailError((prev) => ({ ...prev, [areaId]: payload.filter_error }));
        }
      } catch (err) {
        console.error('[ProcessAreaVisualizer] Failed to load detail OCDFG', err);
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
    [backendBaseUrl, eventLogId],
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
  }, [fetchTotem, effectiveReloadSignal]);

  useEffect(() => {
    setPendingCenter((value) => value + 1);
    setProcessAreaScale(DEFAULT_PROCESS_AREA_SCALE);
    setSmoothedProcessAreaScale(DEFAULT_PROCESS_AREA_SCALE);
  }, [effectiveReloadSignal]);

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
  }, [eventLogId]);

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

        // Create set of detail node IDs to exclude from obstacle routing
        const detailNodeIds = new Set(detailNodes.map((d) => d.id));

        const nodeAreaMap: Map<string, string> = new Map();
        layers.forEach((layer) => {
          layer.areas.forEach((area) => {
            area.objectTypes.forEach((obj) => nodeAreaMap.set(obj, area.id));
          });
        });

        const segments = computeEdgeSegments(
          allEdges,
          mergedPositions,
          areaAnchorMembers,
          areaRects,
          detailNodeIds,
          edgeStrokeScale,
          nodeColumns,
          nodeAreaMap,
        );
        setEdgeSegments(segments);

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

        const extraCanvasMargin = 240;
        const boundsWidth = Math.max(0, bounds?.width ?? 0);
        const boundsHeight = Math.max(0, vBounds?.height ?? 0);
        const desiredWidth = Math.max(
          contentRect.width,
          boundsWidth + contentPaddingLeft + horizontalPadding + extraCanvasMargin,
        );
        const desiredHeight = Math.max(
          contentRect.height,
          boundsHeight + contentPaddingTop + 72 + extraCanvasMargin,
        );

        setContentSize({
          width: Math.max(1, Math.ceil(desiredWidth)),
          height: Math.max(1, Math.ceil(desiredHeight)),
        });

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

  const visualizerContent = (
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
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
        style={{
          position: 'relative',
          height: '100%',
          width: '100%',
          overflow: 'auto',
          background: '#FFFFFF',
          cursor: !autoZoomEnabled ? (isPanning ? 'grabbing' : 'grab') : 'default',
        }}
      >
        <div
          ref={contentRef}
          style={{
            position: 'relative',
            minHeight: '100%',
            width: `${Math.max(contentSize.width, 1)}px`,
            height: `${Math.max(contentSize.height, 1)}px`,
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
              {violatingEdgeSegments.map((edge, vIndex) => {
                const strokeWidth =
                  (edge.relation === 'D'
                    ? 3.2
                    : edge.relation === 'P'
                      ? 3
                      : edge.relation === 'A'
                        ? 2.2
                        : 2.6) * edgeStrokeScale;
                const highlightWidth = strokeWidth + 1.6;
                const highlightColor = '#ec4899';
                const markerStroke = '#be185d';
                const crossSize = 6;
                const labelPoint =
                  edge.crossingPoints?.[0] ??
                  (edge.renderStart && edge.renderEnd
                    ? {
                        x: (edge.renderStart.x + edge.renderEnd.x) / 2,
                        y: (edge.renderStart.y + edge.renderEnd.y) / 2,
                      }
                    : edge.renderStart ?? edge.renderEnd);
                return (
                  <g key={`violation-${edge.id}`}>
                    <path
                      d={edge.path}
                      stroke={highlightColor}
                      strokeWidth={highlightWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                    {edge.crossingPoints?.map((pt, idx) => (
                      <circle
                        key={`violation-${edge.id}-pt-${idx}`}
                        cx={pt.x}
                        cy={pt.y}
                        r={5}
                        fill={highlightColor}
                        stroke={markerStroke}
                        strokeWidth={1.6}
                      />
                    ))}
                    {edge.renderStart && (
                      <g>
                        <line
                          x1={edge.renderStart.x - crossSize}
                          y1={edge.renderStart.y - crossSize}
                          x2={edge.renderStart.x + crossSize}
                          y2={edge.renderStart.y + crossSize}
                          stroke={markerStroke}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                        <line
                          x1={edge.renderStart.x - crossSize}
                          y1={edge.renderStart.y + crossSize}
                          x2={edge.renderStart.x + crossSize}
                          y2={edge.renderStart.y - crossSize}
                          stroke={markerStroke}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                      </g>
                    )}
                    {edge.renderEnd && (
                      <g>
                        <line
                          x1={edge.renderEnd.x - crossSize}
                          y1={edge.renderEnd.y - crossSize}
                          x2={edge.renderEnd.x + crossSize}
                          y2={edge.renderEnd.y + crossSize}
                          stroke={markerStroke}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                        <line
                          x1={edge.renderEnd.x - crossSize}
                          y1={edge.renderEnd.y + crossSize}
                          x2={edge.renderEnd.x + crossSize}
                          y2={edge.renderEnd.y - crossSize}
                          stroke={markerStroke}
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                      </g>
                    )}
                    {labelPoint && (
                      <text
                        x={labelPoint.x + 10}
                        y={labelPoint.y - 6}
                        fontSize={12}
                        fontWeight="700"
                        fill={highlightColor}
                        stroke="white"
                        strokeWidth={2}
                        paintOrder="stroke"
                      >
                        {vIndex + 1}
                      </text>
                    )}
                  </g>
                );
              })}
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
                          alignItems: 'center',
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
                          const detailData = cachedDetail;
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
                                alignItems: 'center',
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
                                    zIndex: 10,
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
                                    {loadingDetail ? (
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
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-5 py-3 shadow-lg">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm font-medium text-slate-700">Discovering Totem model…</span>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return visualizerContent;
  }

  return (
    <Card className="@container/card">
      <CardHeader className="items-center relative z-10 justify-between">
        <CardTitle>{title ?? 'Totem Visualizer'}</CardTitle>
        <CardAction className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <ScanIcon className="h-4 w-4 text-muted-foreground" />
            <Slider
              min={MIN_PROCESS_AREA_SCALE}
              max={MAX_PROCESS_AREA_SCALE}
              step={PROCESS_AREA_SCALE_STEP}
              value={[processAreaScale]}
              onValueChange={(values) =>
                handleProcessAreaScaleChange(values?.[0] ?? DEFAULT_PROCESS_AREA_SCALE)
              }
              className="w-[120px]"
            />
          </div>
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
            className="rounded-full h-8 w-8"
            title={autoZoomEnabled ? 'Disable auto-zoom (enables panning)' : 'Enable auto-zoom'}
          >
            <ScanIcon className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInternalReloadSignal((value) => value + 1)}
            className="flex items-center gap-2"
            disabled={!eventLogId}
          >
            <RefreshCcw className="h-4 w-4" />
            Reload
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="h-[600px] p-0">{visualizerContent}</CardContent>
    </Card>
  );
}

export default ProcessAreaVisualizer;
