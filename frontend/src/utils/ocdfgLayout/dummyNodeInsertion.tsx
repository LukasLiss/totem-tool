import { DUMMY_TYPE, generateDummyId, OCDFGLayout } from './LayoutState';
import type { LayoutConfig, LayoutEdge, LayoutNode, LayoutPoint } from './LayoutState';

// Constants for routing (borrowed from edgeRouting.tsx)
const EPSILON = 1e-6;
const BUFFER_SCALE = 0.7;
const CLEARANCE_RATIO = 0.12;
const TURN_PENALTY_FACTOR = 8;
const HORIZONTAL_PENALTY_FACTOR = 6;
const LANE_BLOCK_PENALTY_FACTOR = 3.5;
// New penalties for edge length and crossing minimization
const SEGMENT_LENGTH_PENALTY_FACTOR = 1.5; // Penalty for longer individual segments
const DEVIATION_FROM_DIRECT_PENALTY = 2.0; // Penalty for deviating from direct path
// Edge thickness for highway spacing
// When thicknessFactor = 2 (2x slider setting), typical edge width is:
// strokeBase = Math.max(6, owners.length * 3) * thicknessFactor
// For single owner: 6 * 2 = 12px
// We use this as the lane spacing to perfectly separate parallel edges
const DEFAULT_EDGE_THICKNESS = 12;
const LANE_TOLERANCE_PX = 2;
const MIN_SEGMENT_LENGTH = 4;
const MIN_CORRIDOR_SPAN = DEFAULT_EDGE_THICKNESS * 0.75;
const ALIGNMENT_EPSILON = 0.5;

/**
 * EDGE ROUTING PIPELINE - Main Entry Point
 *
 * This function implements a complete edge routing system for OCDFG (Object-Centric Directly-Follows Graph) layouts.
 * The pipeline consists of four main phases:
 *
 * PHASE 1: A* PATHFINDING
 *   - Uses A* algorithm to find optimal orthogonal routes between source and target nodes
 *   - Routes follow a grid aligned with node positions to avoid overlaps
 *   - Penalizes horizontal movement and turns to prefer vertical flow
 *
 * PHASE 2: DUMMY NODE PLACEMENT
 *   - Places dummy nodes ONLY at bend points (corners) where edge direction changes
 *   - Avoids redundant dummies on straight segments using collinearity detection
 *   - Dummy nodes mark the route but don't render visually
 *
 * PHASE 3: HIGHWAY DETECTION
 *   - Detects overlapping edge segments that follow the same path
 *   - Groups them into "highways" with multiple lanes
 *   - Calculates safe offsets that keep edges within node boundaries
 *
 * PHASE 4: LANE OFFSET APPLICATION
 *   - Offsets dummy nodes perpendicular to flow direction (12px spacing)
 *   - Ensures first/last edge segments remain vertical/horizontal
 *   - Constrains offsets to prevent edges from ending outside nodes
 *
 * After this pipeline, edge routing (in edgeRouting.tsx) simply connects dummy nodes with straight lines.
 */
export function insertDummyNodes(layout: OCDFGLayout, config: LayoutConfig) {
  // Clean up any existing dummy nodes from previous layout runs
  removeExistingDummies(layout);

  // PHASE 1: BUILD ROUTING CONTEXT
  // Create a grid-based routing context from positioned nodes
  // This grid is used by A* to find paths that avoid node overlaps
  const context = buildRoutingContext(layout, config);
  if (!context) {
    console.warn('[DUMMY NODE INSERTION] No routing context available, skipping dummy insertion');
    return;
  }

  let totalDummiesCreated = 0;
  let edgesWithDummies = 0;

  // PHASE 2: ROUTE EACH EDGE AND PLACE DUMMY NODES
  // Process each edge individually to find its optimal path
  Object.values(layout.edges).forEach((edge) => {
    const sourceNode = layout.nodes[edge.source];
    const targetNode = layout.nodes[edge.target];
    if (!sourceNode || !targetNode) return;

    // Skip edges with undefined positions
    if (
      sourceNode.x === undefined ||
      sourceNode.y === undefined ||
      targetNode.x === undefined ||
      targetNode.y === undefined
    ) {
      return;
    }

    // Calculate layer span to determine if routing is needed
    const sourceLayer = sourceNode.layer;
    const targetLayer = targetNode.layer;
    edge.minLayer = Math.min(sourceLayer, targetLayer);
    edge.maxLayer = Math.max(sourceLayer, targetLayer);
    const span = Math.abs(targetLayer - sourceLayer);

    edge.path = [];

    if (span <= 1) {
      // Direct connection between adjacent layers - no intermediate routing needed
      return;
    }

    edgesWithDummies++;

    // Run A* pathfinding to find an optimal orthogonal route
    // The route avoids other nodes and follows the grid structure
    const allowedNodes = new Set<string>([edge.source, edge.target]);
    const startPoint = { x: sourceNode.x, y: sourceNode.y };
    const endPoint = { x: targetNode.x, y: targetNode.y };

    const route = findGridRoute(context, startPoint, endPoint, allowedNodes);
    if (!route || route.length < 3) {
      // Fallback: If A* fails, use simple linear interpolation
      createInterpolatedDummies(layout, edge, sourceNode, targetNode, config);
      totalDummiesCreated += edge.path.length;
      return;
    }

    // Place dummy nodes at bend points (corners) in the route
    // This creates the "skeleton" that the edge will follow
    const dummyIds = createDummiesAtBends(layout, edge, route, config);
    connectDummyChain(layout, edge, dummyIds);
    totalDummiesCreated += dummyIds.length;
    edge.path = dummyIds;
  });

  // PHASE 3 & 4: HIGHWAY DETECTION AND LANE ASSIGNMENT
  // Detect overlapping edge segments and offset them as highway lanes
  // This prevents edges from rendering on top of each other
  buildHighways(layout, config);

  // Invalidate cached segment data to force recalculation
  layout.invalidateSegments();

  console.log(
    `[DUMMY NODE INSERTION] Created ${totalDummiesCreated} routing dummies for ${edgesWithDummies} long-span edges`,
  );
}

function removeExistingDummies(layout: OCDFGLayout) {
  Object.entries(layout.nodes).forEach(([id, node]) => {
    if (node?.type === DUMMY_TYPE) {
      delete layout.nodes[id];
    }
  });

  Object.values(layout.edges).forEach((edge) => {
    edge.path = [];
    edge.laneOffset = 0;
    edge.laneOrientation = undefined;
  });
}

function computeLayerAxisPositions(layout: OCDFGLayout, config: LayoutConfig) {
  const axisPositions: number[] = [];
  const isVertical = config.direction === 'TB';
  const defaultSecondary = isVertical ? config.activityHeight : config.activityWidth;

  let accumulated = config.borderPadding;

  layout.layering.forEach((layer, index) => {
    const layerSizeEntry = layout.layerSizes[index];
    let layerSpan = layerSizeEntry?.size;
    if (!Number.isFinite(layerSpan) || (layerSpan ?? 0) <= 0) {
      layerSpan = estimateLayerSpan(layout, layer, defaultSecondary, isVertical, config);
    }
    const half = (layerSpan ?? defaultSecondary) / 2;
    axisPositions[index] = accumulated + half;
    accumulated += (layerSpan ?? defaultSecondary) + config.layerSep;
  });

  return axisPositions;
}

function estimateLayerSpan(
  layout: OCDFGLayout,
  layer: string[],
  fallback: number,
  isVertical: boolean,
  config: LayoutConfig,
) {
  let maxSecondary = 0;
  layer.forEach((nodeId) => {
    const node = layout.nodes[nodeId];
    if (!node) return;
    const dimension = isVertical ? node.height ?? config.activityHeight : node.width ?? config.activityWidth;
    if (Number.isFinite(dimension)) {
      maxSecondary = Math.max(maxSecondary, dimension);
    }
  });

  return maxSecondary > 0 ? maxSecondary : fallback;
}

function resolveAxisCoordinate(
  axisPositions: number[],
  layerIndex: number,
  config: LayoutConfig,
) {
  if (Number.isFinite(axisPositions[layerIndex])) {
    return axisPositions[layerIndex];
  }

  const defaultStep =
    (config.direction === 'TB' ? config.activityHeight : config.activityWidth) + config.layerSep;

  if (layerIndex > 0 && Number.isFinite(axisPositions[layerIndex - 1])) {
    return axisPositions[layerIndex - 1]! + defaultStep;
  }
  if (layerIndex + 1 < axisPositions.length && Number.isFinite(axisPositions[layerIndex + 1])) {
    return axisPositions[layerIndex + 1]! - defaultStep;
  }

  return config.borderPadding + layerIndex * defaultStep;
}

function interpolateCoordinate(start: number | undefined, end: number | undefined, ratio: number) {
  const a = Number.isFinite(start) ? (start as number) : 0;
  const b = Number.isFinite(end) ? (end as number) : 0;
  return a + (b - a) * ratio;
}

function connectDummyChain(
  layout: OCDFGLayout,
  edge: { source: string; target: string },
  dummyIds: string[],
) {
  const nodes = dummyIds.map((id) => layout.nodes[id]).filter((node): node is LayoutNode => Boolean(node));
  if (nodes.length === 0) {
    return;
  }

  dummyIds.forEach((dummyId, index) => {
    const dummy = layout.nodes[dummyId];
    if (!dummy) return;
    dummy.upper = index === 0 ? edge.source : dummyIds[index - 1];
    dummy.lower = index === dummyIds.length - 1 ? edge.target : dummyIds[index + 1];
  });
}

// Helper types for routing
type BufferRect = {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

interface RoutingContext {
  xs: number[];
  ys: number[];
  xIndex: Map<string, number>;
  yIndex: Map<string, number>;
  buffers: BufferRect[];
  averageStep: number;
  turnPenalty: number;
  horizontalPenalty: number;
  lanePenalty: number;
  verticalBlocks: Map<number, { minY: number; maxY: number; id: string }[]>;
}

type Direction = 'h' | 'v' | null;
type StateKey = `${number}:${number}:${Direction extends null ? 'n' : Direction}`;
type QueueNode = {
  key: StateKey;
  xIndex: number;
  yIndex: number;
  direction: Direction;
  fScore: number;
};

// Build routing context from positioned nodes (copied from edgeRouting.tsx)
function buildRoutingContext(layout: OCDFGLayout, config: LayoutConfig): RoutingContext | null {
  const nodes = Object.values(layout.nodes).filter(
    (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  if (nodes.length === 0) {
    return null;
  }

  const buffers: BufferRect[] = [];
  const xValues: number[] = [];
  const yValues: number[] = [];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodes.forEach((node) => {
    const x = node.x!;
    const y = node.y!;
    xValues.push(x);
    yValues.push(y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    const buffer = computeBufferRect(node, config);
    if (buffer) {
      buffers.push(buffer);
      xValues.push(buffer.minX, buffer.maxX);
      yValues.push(buffer.minY, buffer.maxY);
    }
  });

  const xBase = uniqueSorted(xValues);
  const yBase = uniqueSorted(yValues);

  const xCandidates = [...xBase];
  const yCandidates = [...yBase];

  for (let i = 0; i < xBase.length - 1; i++) {
    const mid = (xBase[i] + xBase[i + 1]) / 2;
    xCandidates.push(mid);
  }
  for (let i = 0; i < yBase.length - 1; i++) {
    const mid = (yBase[i] + yBase[i + 1]) / 2;
    yCandidates.push(mid);
  }

  const xs = uniqueSorted(xCandidates);
  const ys = uniqueSorted(yCandidates);

  if (minX !== Number.POSITIVE_INFINITY && maxX !== Number.NEGATIVE_INFINITY) {
    const spanX = Math.max(maxX - minX, OCDFGLayout.DEFAULT_WIDTH);
    const firstX = xs[0];
    const lastX = xs[xs.length - 1];
    if (firstX !== undefined && lastX !== undefined) {
      xs.unshift(firstX - spanX * CLEARANCE_RATIO);
      xs.push(lastX + spanX * CLEARANCE_RATIO);
    }
  }
  if (minY !== Number.POSITIVE_INFINITY && maxY !== Number.NEGATIVE_INFINITY) {
    const spanY = Math.max(maxY - minY, OCDFGLayout.DEFAULT_HEIGHT);
    const firstY = ys[0];
    const lastY = ys[ys.length - 1];
    if (firstY !== undefined && lastY !== undefined) {
      ys.unshift(firstY - spanY * CLEARANCE_RATIO);
      ys.push(lastY + spanY * CLEARANCE_RATIO);
    }
  }

  const xIndex = new Map<string, number>();
  xs.forEach((value, index) => xIndex.set(coordKey(value), index));
  const yIndex = new Map<string, number>();
  ys.forEach((value, index) => yIndex.set(coordKey(value), index));

  const avgX = meanStep(xs);
  const avgY = meanStep(ys);
  const averageStep = Math.max((avgX + avgY) / 2, 1);
  const turnPenalty = Math.max(averageStep * TURN_PENALTY_FACTOR, averageStep);
  const horizontalPenalty = Math.max(averageStep * HORIZONTAL_PENALTY_FACTOR, averageStep);
  const lanePenalty = Math.max(averageStep * LANE_BLOCK_PENALTY_FACTOR, averageStep);

  const verticalBlocks = new Map<number, { minY: number; maxY: number; id: string }[]>();
  xs.forEach((x, laneIndex) => {
    const blocks: { minY: number; maxY: number; id: string }[] = [];
    buffers.forEach((rect) => {
      if (x > rect.minX + EPSILON && x < rect.maxX - EPSILON) {
        blocks.push({ minY: rect.minY, maxY: rect.maxY, id: rect.id });
      }
    });
    verticalBlocks.set(laneIndex, blocks);
  });

  return {
    xs,
    ys,
    xIndex,
    yIndex,
    buffers,
    averageStep,
    turnPenalty,
    horizontalPenalty,
    lanePenalty,
    verticalBlocks,
  };
}

function computeBufferRect(node: LayoutNode, config: LayoutConfig): BufferRect | null {
  if (
    node.type === DUMMY_TYPE ||
    node.x === undefined ||
    node.y === undefined ||
    !Number.isFinite(node.width) ||
    !Number.isFinite(node.height)
  ) {
    return null;
  }
  const width = node.width ?? OCDFGLayout.DEFAULT_WIDTH;
  const height = node.height ?? OCDFGLayout.DEFAULT_HEIGHT;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const bufferHalfWidth = halfWidth * (1 + BUFFER_SCALE);
  const bufferHalfHeight = halfHeight * (1 + BUFFER_SCALE);
  return {
    id: node.id,
    minX: node.x - bufferHalfWidth,
    maxX: node.x + bufferHalfWidth,
    minY: node.y - bufferHalfHeight,
    maxY: node.y + bufferHalfHeight,
  };
}

function coordKey(value: number) {
  return value.toFixed(3);
}

function uniqueSorted(values: number[]) {
  const map = new Map<string, number>();
  values.forEach((value) => {
    const key = coordKey(value);
    if (!map.has(key)) {
      map.set(key, value);
    }
  });
  return Array.from(map.values()).sort((a, b) => a - b);
}

function meanStep(values: number[]) {
  if (values.length < 2) return 1;
  let total = 0;
  let count = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > EPSILON) {
      total += diff;
      count++;
    }
  }
  return count > 0 ? total / count : 1;
}

// A* pathfinding to find route (simplified from edgeRouting.tsx)
function findGridRoute(
  context: RoutingContext,
  start: LayoutPoint,
  goal: LayoutPoint,
  allowedNodes: Set<string>,
): LayoutPoint[] | null {
  const startX = findCoordIndex(context.xs, context.xIndex, start.x);
  const startY = findCoordIndex(context.ys, context.yIndex, start.y);
  const goalX = findCoordIndex(context.xs, context.xIndex, goal.x);
  const goalY = findCoordIndex(context.ys, context.yIndex, goal.y);
  if (startX === null || startY === null || goalX === null || goalY === null) {
    return null;
  }

  const startKey = buildStateKey(startX, startY, null);
  const goalKeyBase = buildKey(goalX, goalY);

  const open: QueueNode[] = [{
    key: startKey,
    xIndex: startX,
    yIndex: startY,
    direction: null,
    fScore: heuristic(start, goal),
  }];
  const gScore = new Map<StateKey, number>([[startKey, 0]]);
  const cameFrom = new Map<StateKey, StateKey>();
  const nodeByKey = new Map<StateKey, { xIndex: number; yIndex: number; direction: Direction }>([
    [startKey, { xIndex: startX, yIndex: startY, direction: null }],
  ]);
  const visited = new Set<StateKey>();

  const moves: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  while (open.length > 0) {
    open.sort((a, b) => a.fScore - b.fScore);
    const current = open.shift();
    if (!current) break;
    if (visited.has(current.key)) {
      continue;
    }
    visited.add(current.key);

    if (buildKey(current.xIndex, current.yIndex) === goalKeyBase) {
      return reconstructPath(current.key, cameFrom, nodeByKey, context, start, goal);
    }

    const currentPoint = {
      x: context.xs[current.xIndex],
      y: context.ys[current.yIndex],
    };
    const currentCost = gScore.get(current.key) ?? Number.POSITIVE_INFINITY;

    for (const [dx, dy] of moves) {
      const nextX = current.xIndex + dx;
      const nextY = current.yIndex + dy;
      if (nextX < 0 || nextX >= context.xs.length || nextY < 0 || nextY >= context.ys.length) {
        continue;
      }
      const direction = directionFromMove(dx, dy);
      if (!direction) {
        continue;
      }
      const neighborStateKey = buildStateKey(nextX, nextY, direction);
      if (visited.has(neighborStateKey)) {
        continue;
      }

      const nextPoint = { x: context.xs[nextX], y: context.ys[nextY] };
      if (!isSegmentClear(context, currentPoint, nextPoint, allowedNodes)) {
        continue;
      }

      const stepLength = direction === 'h'
        ? Math.abs(nextPoint.x - currentPoint.x)
        : Math.abs(nextPoint.y - currentPoint.y);
      if (stepLength < EPSILON) {
        continue;
      }

      // Base cost is the step length
      let tentative = currentCost + stepLength;

      // Add segment length penalty to discourage unnecessarily long segments
      const segmentLengthPenalty = stepLength * SEGMENT_LENGTH_PENALTY_FACTOR;
      tentative += segmentLengthPenalty;

      // Penalize horizontal movement (prefer vertical flow in TB layout)
      if (direction === 'h') {
        const laneBlocks = computeLaneObstacleScore(
          context,
          nextX,
          Math.min(goal.y, nextPoint.y),
          Math.max(goal.y, nextPoint.y),
          allowedNodes,
        );
        const lanePenalty = laneBlocks > 0 ? laneBlocks * context.lanePenalty : 0;
        tentative += context.horizontalPenalty + lanePenalty;
      }

      // Penalize turns to keep edges straighter
      if (current.direction !== null && current.direction !== direction) {
        tentative += context.turnPenalty;
      }

      // Add deviation penalty: penalize paths that deviate from direct route
      // Calculate how far off the direct path we are
      const directDistance = heuristic(start, goal);
      const currentDistance = heuristic(start, nextPoint);
      const remainingDistance = heuristic(nextPoint, goal);
      const totalPathDistance = currentDistance + remainingDistance;
      const deviation = totalPathDistance - directDistance;
      if (deviation > EPSILON) {
        tentative += deviation * DEVIATION_FROM_DIRECT_PENALTY;
      }

      const prevBest = gScore.get(neighborStateKey);
      if (prevBest !== undefined && tentative >= prevBest - EPSILON) {
        continue;
      }

      cameFrom.set(neighborStateKey, current.key);
      gScore.set(neighborStateKey, tentative);
      nodeByKey.set(neighborStateKey, { xIndex: nextX, yIndex: nextY, direction });
      const heuristicScore = heuristic(nextPoint, goal);
      const total = tentative + heuristicScore;

      const existing = open.findIndex((node) => node.key === neighborStateKey);
      if (existing >= 0) {
        open[existing].fScore = total;
        open[existing].xIndex = nextX;
        open[existing].yIndex = nextY;
        open[existing].direction = direction;
      } else {
        open.push({
          key: neighborStateKey,
          xIndex: nextX,
          yIndex: nextY,
          direction,
          fScore: total,
        });
      }
    }
  }

  return null;
}

function findCoordIndex(values: number[], indexMap: Map<string, number>, value: number) {
  const direct = indexMap.get(coordKey(value));
  if (direct !== undefined) {
    return direct;
  }
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  values.forEach((candidate, idx) => {
    const diff = Math.abs(candidate - value);
    if (diff < bestDistance) {
      bestDistance = diff;
      bestIndex = idx;
    }
  });
  if (bestIndex === -1 || bestDistance > Math.max(meanStep(values) * 0.51, 1)) {
    return null;
  }
  return bestIndex;
}

function buildKey(xIndex: number, yIndex: number) {
  return `${xIndex}:${yIndex}` as const;
}

function buildStateKey(xIndex: number, yIndex: number, direction: Direction): StateKey {
  const dirToken = direction === null ? 'n' : direction;
  return `${xIndex}:${yIndex}:${dirToken}` as StateKey;
}

function directionFromMove(dx: number, dy: number): Direction {
  if (dx !== 0) return 'h';
  if (dy !== 0) return 'v';
  return null;
}

function segmentIntersectsRect(rect: BufferRect, start: LayoutPoint, end: LayoutPoint) {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  if (Math.abs(start.y - end.y) < EPSILON) {
    const y = start.y;
    const insideVertically = y > rect.minY + EPSILON && y < rect.maxY - EPSILON;
    if (!insideVertically) return false;
    return maxX > rect.minX + EPSILON && minX < rect.maxX - EPSILON;
  }

  if (Math.abs(start.x - end.x) < EPSILON) {
    const x = start.x;
    const insideHorizontally = x > rect.minX + EPSILON && x < rect.maxX - EPSILON;
    if (!insideHorizontally) return false;
    return maxY > rect.minY + EPSILON && minY < rect.maxY - EPSILON;
  }

  return false;
}

function isSegmentClear(
  context: RoutingContext,
  start: LayoutPoint,
  end: LayoutPoint,
  allowed: Set<string>,
) {
  for (const rect of context.buffers) {
    if (allowed.has(rect.id)) continue;
    if (segmentIntersectsRect(rect, start, end)) {
      return false;
    }
  }
  return true;
}

function heuristic(a: LayoutPoint, b: LayoutPoint) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(
  goalKey: StateKey,
  cameFrom: Map<StateKey, StateKey>,
  nodeByKey: Map<StateKey, { xIndex: number; yIndex: number; direction: Direction }>,
  context: RoutingContext,
  start: LayoutPoint,
  goal: LayoutPoint,
) {
  const indices: { xIndex: number; yIndex: number }[] = [];
  let currentKey: StateKey | undefined = goalKey;
  while (currentKey) {
    const coords = nodeByKey.get(currentKey);
    if (!coords) break;
    indices.push({ xIndex: coords.xIndex, yIndex: coords.yIndex });
    currentKey = cameFrom.get(currentKey);
  }
  if (indices.length === 0) {
    return null;
  }
  indices.reverse();
  const points: LayoutPoint[] = indices.map((coords) => ({
    x: context.xs[coords.xIndex],
    y: context.ys[coords.yIndex],
  }));

  if (points.length === 0) {
    return null;
  }

  points[0] = { x: start.x, y: start.y };
  points[points.length - 1] = { x: goal.x, y: goal.y };
  return points;
}

function computeLaneObstacleScore(
  context: RoutingContext,
  laneIndex: number,
  minY: number,
  maxY: number,
  allowedNodes: Set<string>,
) {
  if (minY > maxY) {
    [minY, maxY] = [maxY, minY];
  }
  const blocks = context.verticalBlocks.get(laneIndex);
  if (!blocks || blocks.length === 0) {
    return 0;
  }
  let overlap = 0;
  blocks.forEach((block) => {
    if (allowedNodes.has(block.id)) return;
    if (block.maxY <= minY + EPSILON || block.minY >= maxY - EPSILON) {
      return;
    }
    const localMin = Math.max(block.minY, minY);
    const localMax = Math.min(block.maxY, maxY);
    const segment = localMax - localMin;
    if (segment > EPSILON) {
      overlap += segment;
    }
  });
  return overlap;
}

// Create dummies at bend points in the route
function createDummiesAtBends(
  layout: OCDFGLayout,
  edge: { id: string; owners: string[] },
  route: LayoutPoint[],
  config: LayoutConfig,
): string[] {
  const dummyIds: string[] = [];

  if (route.length < 3) return dummyIds;

  // Only create dummies at actual bend points where direction changes
  for (let i = 1; i < route.length - 1; i++) {
    const prev = route[i - 1];
    const current = route[i];
    const next = route[i + 1];

    // Check if this is a bend point (direction changes)
    const isBend = !isCollinear(prev, current, next);

    if (isBend) {
      const dummyId = generateDummyId();

      const dummy: LayoutNode = {
        id: dummyId,
        label: '',
        objectTypes: [...edge.owners],
        type: DUMMY_TYPE,
        layer: -1, // Will be determined later
        pos: -1,
        x: current.x,
        y: current.y,
        width: config.dummyWidth,
        height: config.dummyHeight,
        belongsTo: edge.id,
        upper: undefined,
        lower: undefined,
        isInHighwayBundle: false,
        bundleIndex: undefined,
      };

      layout.nodes[dummyId] = dummy;
      dummyIds.push(dummyId);
    }
  }

  console.log(`[DUMMY] Edge ${edge.id}: route has ${route.length} points, created ${dummyIds.length} bend dummies`);

  return dummyIds;
}

// Check if three points are collinear (on the same line)
function isCollinear(p1: LayoutPoint, p2: LayoutPoint, p3: LayoutPoint): boolean {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;

  // Check if direction is the same (horizontal or vertical)
  const isHorizontal1 = Math.abs(dy1) < EPSILON;
  const isHorizontal2 = Math.abs(dy2) < EPSILON;
  const isVertical1 = Math.abs(dx1) < EPSILON;
  const isVertical2 = Math.abs(dx2) < EPSILON;

  // Points are collinear if both segments are horizontal or both are vertical
  return (isHorizontal1 && isHorizontal2) || (isVertical1 && isVertical2);
}

// Fallback: create dummies with simple interpolation
function createInterpolatedDummies(
  layout: OCDFGLayout,
  edge: { id: string; source: string; target: string; owners: string[]; path: string[] },
  sourceNode: LayoutNode,
  targetNode: LayoutNode,
  config: LayoutConfig,
) {
  const sourceLayer = sourceNode.layer;
  const targetLayer = targetNode.layer;
  const layerDiff = targetLayer - sourceLayer;
  const direction = layerDiff >= 0 ? 1 : -1;
  const span = Math.abs(layerDiff);

  const isVertical = config.direction === 'TB';
  const layerAxisPositions = computeLayerAxisPositions(layout, config);

  const dummyIds: string[] = [];
  for (let step = 1; step < span; step++) {
    const layerIndex = sourceLayer + direction * step;
    const dummyId = generateDummyId();
    const ratio = step / span;
    const axisCoord = resolveAxisCoordinate(layerAxisPositions, layerIndex, config);
    const crossCoord = interpolateCoordinate(
      isVertical ? sourceNode.x : sourceNode.y,
      isVertical ? targetNode.x : targetNode.y,
      ratio,
    );

    const dummy: LayoutNode = {
      id: dummyId,
      label: '',
      objectTypes: [...edge.owners],
      type: DUMMY_TYPE,
      layer: layerIndex,
      pos: -1,
    x: isVertical ? crossCoord : axisCoord,
    y: isVertical ? axisCoord : crossCoord,
    width: config.dummyWidth,
    height: config.dummyHeight,
    belongsTo: edge.id,
    upper: undefined,
    lower: undefined,
    isInHighwayBundle: false,
    bundleIndex: undefined,
  };

    layout.nodes[dummyId] = dummy;
    dummyIds.push(dummyId);
  }

  connectDummyChain(layout, edge, dummyIds);
  edge.path = dummyIds;
}

// Build highways: detect overlapping edge segments and offset them as lanes
function buildHighways(layout: OCDFGLayout, config: LayoutConfig) {
  // Reset bundle markers for the debug overlay
  Object.values(layout.nodes).forEach((node) => {
    if (node?.type === DUMMY_TYPE) {
      node.isInHighwayBundle = false;
      node.bundleIndex = undefined;
    }
  });

  const initialPaths = buildEdgePathMap(layout);
  const { segments: initialSegments } = collectEdgeSegments(layout, initialPaths);
  const initialOverlaps = detectCorridorOverlaps(initialSegments);

  insertAlignmentAnchors(layout, config, initialPaths, initialSegments, initialOverlaps);

  const updatedPaths = buildEdgePathMap(layout);
  const { segments, segmentById } = collectEdgeSegments(layout, updatedPaths);
  const overlapMap = detectCorridorOverlaps(segments);
  if (overlapMap.size === 0) {
    console.log('[HIGHWAY] No corridors detected');
    return;
  }

  const corridors = groupCorridors(segments, overlapMap, segmentById);
  if (corridors.length === 0) {
    console.log('[HIGHWAY] No corridor groups qualified for lanes');
    return;
  }

  const assignments = assignLaneOffsets(layout, corridors, DEFAULT_EDGE_THICKNESS);
  if (assignments.size === 0) {
    console.log('[HIGHWAY] Corridor detection succeeded, but no multi-lane bundles found');
    return;
  }

  applyLaneOffsetsToDummies(layout, assignments);
  console.log(`[HIGHWAY] Built ${corridors.length} corridor(s); lane offsets applied to ${assignments.size} edge(s)`);
}

type SegmentOrientation = 'horizontal' | 'vertical';

type HighwaySegment = {
  id: string;
  edgeId: string;
  startNodeId: string;
  endNodeId: string;
  start: LayoutPoint;
  end: LayoutPoint;
  orientation: SegmentOrientation;
  layerIndex: number;
  orthCoord: number;
  rangeMin: number;
  rangeMax: number;
  length: number;
};

type OverlapRecord = {
  otherId: string;
  from: number;
  to: number;
};

type CorridorGroup = {
  id: string;
  orientation: SegmentOrientation;
  layerIndex: number;
  segments: HighwaySegment[];
};

type LaneAssignment = {
  orientation: SegmentOrientation;
  offset: number;
};

function buildEdgePathMap(layout: OCDFGLayout) {
  const pathMap = new Map<string, string[]>();
  Object.values(layout.edges).forEach((edge) => {
    pathMap.set(edge.id, [edge.source, ...edge.path, edge.target]);
  });
  return pathMap;
}

function collectEdgeSegments(
  layout: OCDFGLayout,
  pathMap: Map<string, string[]>,
) {
  const segments: HighwaySegment[] = [];
  const segmentById = new Map<string, HighwaySegment>();

  pathMap.forEach((nodeIds, edgeId) => {
    const edge = layout.edges[edgeId];
    if (!edge) return;

    for (let idx = 0; idx < nodeIds.length - 1; idx++) {
      const startNode = layout.nodes[nodeIds[idx]];
      const endNode = layout.nodes[nodeIds[idx + 1]];
      if (
        !startNode ||
        !endNode ||
        startNode.x === undefined ||
        startNode.y === undefined ||
        endNode.x === undefined ||
        endNode.y === undefined
      ) {
        continue;
      }

      const dx = endNode.x - startNode.x;
      const dy = endNode.y - startNode.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      let orientation: SegmentOrientation | null = null;
      if (absDy < EPSILON && absDx >= MIN_SEGMENT_LENGTH) {
        orientation = 'horizontal';
      } else if (absDx < EPSILON && absDy >= MIN_SEGMENT_LENGTH) {
        orientation = 'vertical';
      }
      if (!orientation) continue;

      const orthCoord = orientation === 'horizontal'
        ? (startNode.y + endNode.y) / 2
        : (startNode.x + endNode.x) / 2;
      const rangeMin = orientation === 'horizontal'
        ? Math.min(startNode.x, endNode.x)
        : Math.min(startNode.y, endNode.y);
      const rangeMax = orientation === 'horizontal'
        ? Math.max(startNode.x, endNode.x)
        : Math.max(startNode.y, endNode.y);
      const length = rangeMax - rangeMin;
      if (length < MIN_SEGMENT_LENGTH) continue;

      const layerIndex = inferSegmentLayerIndex(layout, edge, startNode, endNode);
      const id = `${edgeId}:${idx}`;
      const segment: HighwaySegment = {
        id,
        edgeId,
        startNodeId: startNode.id,
        endNodeId: endNode.id,
        start: { x: startNode.x, y: startNode.y },
        end: { x: endNode.x, y: endNode.y },
        orientation,
        layerIndex,
        orthCoord,
        rangeMin,
        rangeMax,
        length,
      };
      segments.push(segment);
      segmentById.set(id, segment);
    }
  });

  return { segments, segmentById };
}

function inferSegmentLayerIndex(
  layout: OCDFGLayout,
  edge: LayoutEdge,
  startNode: LayoutNode,
  endNode: LayoutNode,
) {
  const candidates: number[] = [];
  [startNode, endNode].forEach((node) => {
    if (Number.isFinite(node.layer) && (node.layer ?? -1) >= 0) {
      candidates.push(node.layer!);
    }
  });
  if (candidates.length > 0) {
    return Math.min(...candidates);
  }

  if (Number.isFinite(edge.minLayer)) {
    return edge.minLayer;
  }

  const fallback: number[] = [];
  const sourceLayer = layout.nodes[edge.source]?.layer;
  const targetLayer = layout.nodes[edge.target]?.layer;
  if (Number.isFinite(sourceLayer)) fallback.push(sourceLayer!);
  if (Number.isFinite(targetLayer)) fallback.push(targetLayer!);

  return fallback.length > 0 ? Math.min(...fallback) : 0;
}

function detectCorridorOverlaps(segments: HighwaySegment[]) {
  const overlaps = new Map<string, OverlapRecord[]>();
  const buckets = bucketSegments(segments);

  buckets.forEach((bucketSegments) => {
    if (bucketSegments.length < 2) return;
    const sorted = [...bucketSegments].sort((a, b) => a.rangeMin - b.rangeMin);
    const active: HighwaySegment[] = [];

    sorted.forEach((segment) => {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].rangeMax < segment.rangeMin - ALIGNMENT_EPSILON) {
          active.splice(i, 1);
        }
      }

      active.forEach((candidate) => {
        if (candidate.edgeId === segment.edgeId) {
          return;
        }
        const overlapStart = Math.max(candidate.rangeMin, segment.rangeMin);
        const overlapEnd = Math.min(candidate.rangeMax, segment.rangeMax);
        const overlapLength = overlapEnd - overlapStart;
        if (overlapLength >= MIN_CORRIDOR_SPAN) {
          addOverlapRecord(overlaps, candidate.id, segment.id, overlapStart, overlapEnd);
        }
      });

      active.push(segment);
      active.sort((a, b) => a.rangeMax - b.rangeMax);
    });
  });

  return overlaps;
}

function bucketSegments(segments: HighwaySegment[]) {
  const buckets = new Map<string, HighwaySegment[]>();
  segments.forEach((segment) => {
    const quantized = quantizeCoordinate(segment.orthCoord);
    const key = `${segment.orientation}:${segment.layerIndex}:${quantized}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(segment);
    } else {
      buckets.set(key, [segment]);
    }
  });
  return buckets;
}

function quantizeCoordinate(value: number) {
  return Math.round(value / LANE_TOLERANCE_PX);
}

function addOverlapRecord(
  overlaps: Map<string, OverlapRecord[]>,
  firstId: string,
  secondId: string,
  from: number,
  to: number,
) {
  const firstRecords = overlaps.get(firstId) ?? [];
  firstRecords.push({ otherId: secondId, from, to });
  overlaps.set(firstId, firstRecords);

  const secondRecords = overlaps.get(secondId) ?? [];
  secondRecords.push({ otherId: firstId, from, to });
  overlaps.set(secondId, secondRecords);
}

function insertAlignmentAnchors(
  layout: OCDFGLayout,
  config: LayoutConfig,
  pathMap: Map<string, string[]>,
  segments: HighwaySegment[],
  overlaps: Map<string, OverlapRecord[]>,
) {
  if (overlaps.size === 0) return;

  const segmentLookup = new Map(segments.map((segment) => [segment.id, segment]));
  const processedPairs = new Set<string>();

  overlaps.forEach((records, segmentId) => {
    const segment = segmentLookup.get(segmentId);
    if (!segment) return;
    records.forEach((record) => {
      const other = segmentLookup.get(record.otherId);
      if (!other) return;
      const pairKey = segmentId < record.otherId
        ? `${segmentId}|${record.otherId}`
        : `${record.otherId}|${segmentId}`;
      if (processedPairs.has(pairKey)) return;
      processedPairs.add(pairKey);

      insertAnchorsForSegment(layout, config, pathMap, segment, record);
      insertAnchorsForSegment(layout, config, pathMap, other, record);
    });
  });
}

function insertAnchorsForSegment(
  layout: OCDFGLayout,
  config: LayoutConfig,
  pathMap: Map<string, string[]>,
  segment: HighwaySegment,
  overlap: OverlapRecord,
) {
  const edge = layout.edges[segment.edgeId];
  const path = pathMap.get(segment.edgeId);
  if (!edge || !path) return;

  const needsStartAnchor = segment.rangeMin < overlap.from - ALIGNMENT_EPSILON;
  const needsEndAnchor = segment.rangeMax > overlap.to + ALIGNMENT_EPSILON;

  if (needsStartAnchor) {
    ensureAlignmentPoint(layout, config, edge, path, segment, overlap.from);
  }
  if (needsEndAnchor) {
    ensureAlignmentPoint(layout, config, edge, path, segment, overlap.to);
  }
}

function ensureAlignmentPoint(
  layout: OCDFGLayout,
  config: LayoutConfig,
  edge: LayoutEdge,
  path: string[],
  segment: HighwaySegment,
  axisValue: number,
) {
  const startIndex = path.indexOf(segment.startNodeId);
  const endIndex = path.indexOf(segment.endNodeId);
  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return;
  }

  for (let idx = startIndex; idx < endIndex; idx++) {
    const leftNode = layout.nodes[path[idx]];
    const rightNode = layout.nodes[path[idx + 1]];
    if (
      !leftNode ||
      !rightNode ||
      leftNode.x === undefined ||
      leftNode.y === undefined ||
      rightNode.x === undefined ||
      rightNode.y === undefined
    ) {
      continue;
    }

    const leftAxis = segment.orientation === 'horizontal' ? leftNode.x : leftNode.y;
    const rightAxis = segment.orientation === 'horizontal' ? rightNode.x : rightNode.y;
    if (leftAxis === undefined || rightAxis === undefined) {
      continue;
    }

    if (Math.abs(axisValue - leftAxis) < ALIGNMENT_EPSILON || Math.abs(axisValue - rightAxis) < ALIGNMENT_EPSILON) {
      return;
    }

    const minAxis = Math.min(leftAxis, rightAxis);
    const maxAxis = Math.max(leftAxis, rightAxis);
    if (axisValue <= minAxis + ALIGNMENT_EPSILON || axisValue >= maxAxis - ALIGNMENT_EPSILON) {
      continue;
    }

    const position = segment.orientation === 'horizontal'
      ? { x: axisValue, y: segment.orthCoord }
      : { x: segment.orthCoord, y: axisValue };
    const dummyId = addAlignmentDummy(layout, edge, position, config);
    path.splice(idx + 1, 0, dummyId);
    edge.path = path.slice(1, path.length - 1);
    connectDummyChain(layout, edge, edge.path);
    return;
  }
}

function addAlignmentDummy(
  layout: OCDFGLayout,
  edge: LayoutEdge,
  position: LayoutPoint,
  config: LayoutConfig,
) {
  const dummyId = generateDummyId();
  layout.nodes[dummyId] = {
    id: dummyId,
    label: '',
    objectTypes: [...edge.owners],
    type: DUMMY_TYPE,
    layer: -1,
    pos: -1,
    x: position.x,
    y: position.y,
    width: config.dummyWidth,
    height: config.dummyHeight,
    belongsTo: edge.id,
    upper: undefined,
    lower: undefined,
    isInHighwayBundle: false,
    bundleIndex: undefined,
  };
  return dummyId;
}

function groupCorridors(
  segments: HighwaySegment[],
  overlaps: Map<string, OverlapRecord[]>,
  segmentById: Map<string, HighwaySegment>,
) {
  const adjacency = new Map<string, Set<string>>();
  overlaps.forEach((records, segmentId) => {
    const neighbors = adjacency.get(segmentId) ?? new Set<string>();
    records.forEach((record) => neighbors.add(record.otherId));
    adjacency.set(segmentId, neighbors);
  });

  const visited = new Set<string>();
  const corridors: CorridorGroup[] = [];
  let corridorCounter = 0;

  adjacency.forEach((_, segmentId) => {
    if (visited.has(segmentId)) return;
    const stack = [segmentId];
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      const neighbors = adjacency.get(current);
      neighbors?.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      });
    }

    if (component.length < 2) return;
    const componentSegments = component
      .map((id) => segmentById.get(id))
      .filter((segment): segment is HighwaySegment => Boolean(segment));
    if (componentSegments.length < 2) return;

    corridors.push({
      id: `corridor-${corridorCounter++}`,
      orientation: componentSegments[0]!.orientation,
      layerIndex: componentSegments[0]!.layerIndex,
      segments: componentSegments,
    });
  });

  return corridors;
}

function assignLaneOffsets(
  layout: OCDFGLayout,
  corridors: CorridorGroup[],
  edgeThickness: number,
) {
  const assignments = new Map<string, LaneAssignment>();
  let bundleCursor = 0;

  corridors.forEach((corridor, corridorIndex) => {
    const segmentsByEdge = new Map<string, HighwaySegment[]>();
    corridor.segments.forEach((segment) => {
      const list = segmentsByEdge.get(segment.edgeId) ?? [];
      list.push(segment);
      segmentsByEdge.set(segment.edgeId, list);
    });

    const uniqueEdges = Array.from(segmentsByEdge.entries()).map(([edgeId, segmentList]) => ({
      edgeId,
      representative: segmentList[0]!,
      segments: segmentList,
    }));

    if (uniqueEdges.length < 2) {
      return;
    }

    uniqueEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    const laneCount = uniqueEdges.length;
    const startOffset = -((laneCount - 1) * edgeThickness) / 2;

    uniqueEdges.forEach(({ edgeId, representative, segments }, laneIndex) => {
      const offset = startOffset + laneIndex * edgeThickness;
      registerEdgeLane(assignments, edgeId, representative.orientation, offset);
      markSegmentNodes(layout, segments, bundleCursor + laneIndex);
    });

    console.log(
      `[HIGHWAY] Corridor ${corridorIndex}: ${laneCount} lane(s), orientation ${corridor.orientation}, layer ${corridor.layerIndex}`,
    );

    bundleCursor += laneCount;
  });

  return assignments;
}

function registerEdgeLane(
  assignments: Map<string, LaneAssignment>,
  edgeId: string,
  orientation: SegmentOrientation,
  offset: number,
) {
  const existing = assignments.get(edgeId);
  if (!existing) {
    assignments.set(edgeId, { orientation, offset });
    return;
  }

  if (existing.orientation === orientation && Math.abs(offset) > Math.abs(existing.offset)) {
    assignments.set(edgeId, { orientation, offset });
    return;
  }

  if (orientation === 'vertical' && existing.orientation === 'horizontal') {
    assignments.set(edgeId, { orientation, offset });
  }
}

function markSegmentNodes(
  layout: OCDFGLayout,
  segments: HighwaySegment[],
  bundleIndex: number,
) {
  segments.forEach((segment) => {
    [segment.startNodeId, segment.endNodeId].forEach((nodeId) => {
      const node = layout.nodes[nodeId];
      if (!node || node.type !== DUMMY_TYPE) return;
      node.isInHighwayBundle = true;
      node.bundleIndex = bundleIndex;
    });
  });
}

function applyLaneOffsetsToDummies(
  layout: OCDFGLayout,
  assignments: Map<string, LaneAssignment>,
) {
  assignments.forEach(({ orientation, offset }, edgeId) => {
    const edge = layout.edges[edgeId];
    if (!edge) return;

    edge.path.forEach((dummyId) => {
      const dummy = layout.nodes[dummyId];
      if (!dummy || dummy.type !== DUMMY_TYPE) return;
      if (dummy.x === undefined || dummy.y === undefined) return;
      if (orientation === 'horizontal') {
        dummy.y += offset;
      } else {
        dummy.x += offset;
      }
    });

    edge.laneOffset = offset;
    edge.laneOrientation = orientation;
    console.log(
      `[HIGHWAY] Edge ${edgeId} offset ${offset.toFixed(1)} (${orientation}) with ${edge.path.length} dummy waypoint(s)`,
    );
  });
}
