import { DUMMY_TYPE, OCDFGLayout, type LayoutNode, type LayoutPoint } from './LayoutState';

const EPSILON = 1e-6;
const BUFFER_SCALE = 0.7;
const CLEARANCE_RATIO = 0.12;
const TURN_PENALTY_FACTOR = 8;
const HORIZONTAL_PENALTY_FACTOR = 6;
const LANE_BLOCK_PENALTY_FACTOR = 3.5;

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

function pushPoint(points: LayoutPoint[], point: LayoutPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) {
    return;
  }
  points.push(point);
}

function projectFromNode(node: LayoutNode, towards: LayoutPoint, margin: number): LayoutPoint {
  if (
    node.width === 0 ||
    node.height === 0 ||
    node.x === undefined ||
    node.y === undefined
  ) {
    return { x: towards.x, y: towards.y };
  }

  const center = { x: node.x, y: node.y };
  const dx = center.x - towards.x;
  const dy = center.y - towards.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < EPSILON && absDy < EPSILON) {
    return { x: center.x, y: center.y };
  }

  const halfWidth = (node.width || OCDFGLayout.DEFAULT_WIDTH) / 2 + margin;
  const halfHeight = (node.height || OCDFGLayout.DEFAULT_HEIGHT) / 2 + margin;
  const scale = Math.max(absDx / halfWidth, absDy / halfHeight, 1e-3);

  return {
    x: center.x - dx / scale,
    y: center.y - dy / scale,
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

function computeBufferRect(node: LayoutNode): BufferRect | null {
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

function buildRoutingContext(layout: OCDFGLayout): RoutingContext | null {
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

    const buffer = computeBufferRect(node);
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

      let tentative = currentCost + stepLength;
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
      if (current.direction !== null && current.direction !== direction) {
        tentative += context.turnPenalty;
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

function simplifyPolyline(points: LayoutPoint[]): LayoutPoint[] {
  if (points.length <= 2) {
    return points;
  }
  const simplified: LayoutPoint[] = [];
  pushPoint(simplified, points[0]);
  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const next = points[i + 1];
    if (!prev || !next) {
      pushPoint(simplified, current);
      continue;
    }
    const isHorizontal =
      Math.abs(prev.y - current.y) < EPSILON && Math.abs(current.y - next.y) < EPSILON;
    const isVertical =
      Math.abs(prev.x - current.x) < EPSILON && Math.abs(current.x - next.x) < EPSILON;
    if (isHorizontal || isVertical) {
      continue;
    }
    pushPoint(simplified, current);
  }
  pushPoint(simplified, points[points.length - 1]);
  return simplified;
}

function fallbackDirect(edge: { polyline?: LayoutPoint[] }, source: LayoutNode, target: LayoutNode) {
  if (
    source.x === undefined ||
    source.y === undefined ||
    target.x === undefined ||
    target.y === undefined
  ) {
    delete edge.polyline;
    return;
  }
  const startCenter = { x: source.x, y: source.y };
  const endCenter = { x: target.x, y: target.y };
  const route: LayoutPoint[] = [startCenter];

  const horizontalAligned = Math.abs(startCenter.y - endCenter.y) < EPSILON;
  const verticalAligned = Math.abs(startCenter.x - endCenter.x) < EPSILON;

  if (!horizontalAligned && !verticalAligned) {
    route.push({ x: endCenter.x, y: startCenter.y });
  }
  route.push(endCenter);

  const boundaryStart = projectFromNode(source, route[1] ?? endCenter, 0);
  const boundaryEnd = projectFromNode(target, route[route.length - 2] ?? startCenter, 0);

  const basePolyline: LayoutPoint[] = [];
  pushPoint(basePolyline, boundaryStart);
  for (let i = 1; i < route.length - 1; i++) {
    pushPoint(basePolyline, route[i]);
  }
  pushPoint(basePolyline, boundaryEnd);

  const simplified = simplifyPolyline(basePolyline);
  edge.polyline = simplified.length >= 2 ? simplified : undefined;
}

function buildEdgePolyline(
  layout: OCDFGLayout,
  context: RoutingContext,
  edgeId: string,
) {
  const edge = layout.edges[edgeId];
  if (!edge || edge.reversed) return;

  const sourceNode = layout.nodes[edge.source];
  const targetNode = layout.nodes[edge.target];
  if (!sourceNode || !targetNode) {
    delete edge.polyline;
    return;
  }
  if (
    sourceNode.x === undefined ||
    sourceNode.y === undefined ||
    targetNode.x === undefined ||
    targetNode.y === undefined
  ) {
    delete edge.polyline;
    return;
  }

  const allowedNodes = new Set<string>([edge.source, edge.target]);
  edge.path.forEach((id) => allowedNodes.add(id));

  const startPoint = { x: sourceNode.x, y: sourceNode.y };
  const endPoint = { x: targetNode.x, y: targetNode.y };

  const route = findGridRoute(context, startPoint, endPoint, allowedNodes);
  if (!route || route.length < 2) {
    fallbackDirect(edge, sourceNode, targetNode);
    return;
  }

  const boundaryStart = projectFromNode(sourceNode, route[1] ?? endPoint, 0);
  const boundaryEnd = projectFromNode(targetNode, route[route.length - 2] ?? startPoint, 0);

  const basePolyline: LayoutPoint[] = [];
  pushPoint(basePolyline, boundaryStart);
  for (let i = 1; i < route.length - 1; i++) {
    pushPoint(basePolyline, route[i]);
  }
  pushPoint(basePolyline, boundaryEnd);

  const simplified = simplifyPolyline(basePolyline);
  if (simplified.length >= 2) {
    edge.polyline = simplified;
  } else {
    fallbackDirect(edge, sourceNode, targetNode);
  }
}

export function routeEdges(layout: OCDFGLayout) {
  layout.clearRoutingDummies();
  Object.entries(layout.edges).forEach(([edgeId, edge]) => {
    if (!edge.original) {
      delete layout.edges[edgeId];
    } else if (edge.reversed) {
      edge.source = edge.originalSource;
      edge.target = edge.originalTarget;
      edge.reversed = false;
    }
    if (edge) {
      edge.polyline = undefined;
    }
  });

  const context = buildRoutingContext(layout);

  Object.keys(layout.edges).forEach((edgeId) => {
    if (context) {
      buildEdgePolyline(layout, context, edgeId);
    } else {
      const edge = layout.edges[edgeId];
      if (!edge) return;
      const sourceNode = layout.nodes[edge.source];
      const targetNode = layout.nodes[edge.target];
      if (!sourceNode || !targetNode) {
        delete edge.polyline;
        return;
      }
      fallbackDirect(edge, sourceNode, targetNode);
    }
  });

  layout.invalidateSegments();
}
