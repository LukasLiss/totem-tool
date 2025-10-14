import { type LayoutConfig, OCDFGLayout, type LayoutNode, type LayoutPoint } from './LayoutState';

const EPSILON = 1e-6;
const DEFAULT_GRID_CELL = 32;
const GRID_MARGIN_FACTOR = 0.75;
const OBSTACLE_PADDING_FACTOR = 0.6;

interface GridContext {
  originX: number;
  originY: number;
  cellSize: number;
  width: number;
  height: number;
  blocked: Uint8Array;
}

interface GridPoint {
  x: number;
  y: number;
}

function pushPoint(points: LayoutPoint[], point: LayoutPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) {
    return;
  }
  points.push(point);
}

function getCenter(layout: OCDFGLayout, nodeId: string): LayoutPoint | null {
  const node = layout.nodes[nodeId];
  if (!node) return null;
  if (node.x === undefined || node.y === undefined) return null;
  return { x: node.x, y: node.y };
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

function buildRoutingGrid(layout: OCDFGLayout, config?: LayoutConfig): GridContext {
  const nodes = Object.values(layout.nodes).filter(
    (node) =>
      node.x !== undefined &&
      node.y !== undefined &&
      (node.width ?? 0) >= 0 &&
      (node.height ?? 0) >= 0,
  );

  if (nodes.length === 0) {
    const cellSize = config ? Math.max(8, Math.min(config.layerSep, config.vertexSep) / 6) : DEFAULT_GRID_CELL;
    return {
      originX: -cellSize,
      originY: -cellSize,
      cellSize,
      width: 8,
      height: 8,
      blocked: new Uint8Array(64),
    };
  }

  const baseSep = Math.max(
    16,
    Math.min(
      config?.layerSep ?? DEFAULT_GRID_CELL * 3,
      config?.vertexSep ?? DEFAULT_GRID_CELL * 3,
    ),
  );
  const cellSize = Math.max(8, Math.min(baseSep / 6, DEFAULT_GRID_CELL));
  const margin = Math.max(cellSize * 6, baseSep * GRID_MARGIN_FACTOR);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodes.forEach((node) => {
    const halfW = (node.width ?? OCDFGLayout.DEFAULT_WIDTH) / 2;
    const halfH = (node.height ?? OCDFGLayout.DEFAULT_HEIGHT) / 2;
    minX = Math.min(minX, (node.x ?? 0) - halfW);
    maxX = Math.max(maxX, (node.x ?? 0) + halfW);
    minY = Math.min(minY, (node.y ?? 0) - halfH);
    maxY = Math.max(maxY, (node.y ?? 0) + halfH);
  });

  const originX = minX - margin;
  const originY = minY - margin;
  const width = Math.max(
    16,
    Math.ceil((maxX - minX + margin * 2) / cellSize) + 4,
  );
  const height = Math.max(
    16,
    Math.ceil((maxY - minY + margin * 2) / cellSize) + 4,
  );

  const blocked = new Uint8Array(width * height);

  nodes.forEach((node) => markNodeObstacle({ originX, originY, cellSize, width, height, blocked }, node, cellSize));

  return { originX, originY, cellSize, width, height, blocked };
}

function markNodeObstacle(grid: GridContext, node: LayoutNode, cellSize: number) {
  if (node.x === undefined || node.y === undefined) return;
  const width = node.width ?? OCDFGLayout.DEFAULT_WIDTH;
  const height = node.height ?? OCDFGLayout.DEFAULT_HEIGHT;
  const padding = cellSize * OBSTACLE_PADDING_FACTOR;

  const minX = node.x - width / 2 - padding;
  const maxX = node.x + width / 2 + padding;
  const minY = node.y - height / 2 - padding;
  const maxY = node.y + height / 2 + padding;

  const startX = Math.max(0, Math.floor((minX - grid.originX) / grid.cellSize));
  const endX = Math.min(grid.width - 1, Math.ceil((maxX - grid.originX) / grid.cellSize));
  const startY = Math.max(0, Math.floor((minY - grid.originY) / grid.cellSize));
  const endY = Math.min(grid.height - 1, Math.ceil((maxY - grid.originY) / grid.cellSize));

  for (let y = startY; y <= endY; y += 1) {
    const rowIndex = y * grid.width;
    for (let x = startX; x <= endX; x += 1) {
      grid.blocked[rowIndex + x] = 1;
    }
  }
}

function pointToCell(grid: GridContext, point: LayoutPoint): GridPoint | null {
  const x = Math.round((point.x - grid.originX) / grid.cellSize);
  const y = Math.round((point.y - grid.originY) / grid.cellSize);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    return null;
  }
  return { x, y };
}

function cellToPoint(grid: GridContext, cell: GridPoint): LayoutPoint {
  return {
    x: grid.originX + (cell.x + 0.5) * grid.cellSize,
    y: grid.originY + (cell.y + 0.5) * grid.cellSize,
  };
}

function gridIndex(grid: GridContext, cell: GridPoint): number {
  return cell.y * grid.width + cell.x;
}

function leeRoute(grid: GridContext, start: GridPoint, goal: GridPoint): GridPoint[] | null {
  const total = grid.width * grid.height;
  const distances = new Int32Array(total).fill(-1);
  const previous = new Int32Array(total).fill(-1);
  const queue: GridPoint[] = [];

  const startIdx = gridIndex(grid, start);
  const goalIdx = gridIndex(grid, goal);

  distances[startIdx] = 0;
  queue.push(start);

  const neighbors = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift() as GridPoint;
    const currentIdx = gridIndex(grid, current);
    if (currentIdx === goalIdx) {
      break;
    }

    for (const delta of neighbors) {
      const nx = current.x + delta.x;
      const ny = current.y + delta.y;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) {
        continue;
      }
      const neighborIdx = ny * grid.width + nx;
      if (grid.blocked[neighborIdx] === 1 || distances[neighborIdx] !== -1) {
        continue;
      }
      distances[neighborIdx] = distances[currentIdx] + 1;
      previous[neighborIdx] = currentIdx;
      queue.push({ x: nx, y: ny });
    }
  }

  if (distances[goalIdx] === -1) {
    return null;
  }

  const path: GridPoint[] = [];
  let currentIdx = goalIdx;
  while (currentIdx !== -1) {
    const cx = currentIdx % grid.width;
    const cy = Math.floor(currentIdx / grid.width);
    path.push({ x: cx, y: cy });
    if (currentIdx === startIdx) {
      break;
    }
    currentIdx = previous[currentIdx];
  }

  path.reverse();
  return path;
}

function markPathAsBlocked(grid: GridContext, path: GridPoint[], preserveEndpoints = true) {
  path.forEach((cell, index) => {
    if (preserveEndpoints && (index === 0 || index === path.length - 1)) {
      return;
    }
    const idx = cell.y * grid.width + cell.x;
    grid.blocked[idx] = 1;
  });
}

function simplifyPolyline(points: LayoutPoint[]) {
  if (points.length <= 2) {
    return points;
  }

  const simplified: LayoutPoint[] = [];
  simplified.push(points[0]);

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const next = points[i + 1];

    const dx1 = current.x - prev.x;
    const dy1 = current.y - prev.y;
    const dx2 = next.x - current.x;
    const dy2 = next.y - current.y;

    if (Math.abs(dx1 * dy2 - dy1 * dx2) < EPSILON) {
      continue;
    }
    simplified.push(current);
  }

  simplified.push(points[points.length - 1]);
  return simplified;
}

function routeEdgeWithLee(
  layout: OCDFGLayout,
  edgeId: string,
  grid: GridContext,
  config?: LayoutConfig,
) {
  const edge = layout.edges[edgeId];
  if (!edge || edge.reversed) return false;

  const sourceNode = layout.nodes[edge.source];
  const targetNode = layout.nodes[edge.target];
  if (!sourceNode || !targetNode) {
    return false;
  }

  const sourceCenter = getCenter(layout, edge.source);
  const targetCenter = getCenter(layout, edge.target);
  if (!sourceCenter || !targetCenter) {
    return false;
  }

  const margin = (config?.dummyWidth ?? 0) / 4;
  const startBoundary = projectFromNode(sourceNode, targetCenter, margin);
  const endBoundary = projectFromNode(targetNode, sourceCenter, margin);

  const startCell = pointToCell(grid, startBoundary);
  const endCell = pointToCell(grid, endBoundary);
  if (!startCell || !endCell) {
    return false;
  }

  const startIdx = gridIndex(grid, startCell);
  const endIdx = gridIndex(grid, endCell);
  const startBlocked = grid.blocked[startIdx];
  const endBlocked = grid.blocked[endIdx];

  grid.blocked[startIdx] = 0;
  grid.blocked[endIdx] = 0;

  const path = leeRoute(grid, startCell, endCell);

  grid.blocked[startIdx] = startBlocked;
  grid.blocked[endIdx] = endBlocked;

  if (!path || path.length < 2) {
    return false;
  }

  markPathAsBlocked(grid, path);

  const polyline: LayoutPoint[] = [];
  pushPoint(polyline, startBoundary);

  for (let i = 1; i < path.length - 1; i += 1) {
    pushPoint(polyline, cellToPoint(grid, path[i]));
  }

  pushPoint(polyline, endBoundary);

  edge.polyline = simplifyPolyline(polyline);
  return true;
}

function buildStraightPolyline(layout: OCDFGLayout, edgeId: string) {
  const edge = layout.edges[edgeId];
  if (!edge || edge.reversed) return;

  const sourceNode = layout.nodes[edge.source];
  const targetNode = layout.nodes[edge.target];
  if (!sourceNode || !targetNode) {
    delete edge.polyline;
    return;
  }

  const sourceCenter = getCenter(layout, edge.source);
  const targetCenter = getCenter(layout, edge.target);
  if (!sourceCenter || !targetCenter) {
    delete edge.polyline;
    return;
  }

  const startBoundary = projectFromNode(sourceNode, targetCenter, 0);
  const endBoundary = projectFromNode(targetNode, sourceCenter, 0);

  const polyline: LayoutPoint[] = [];
  pushPoint(polyline, startBoundary);
  pushPoint(polyline, endBoundary);

  if (polyline.length >= 2) {
    edge.polyline = polyline;
  } else {
    delete edge.polyline;
  }
}

export function routeEdges(layout: OCDFGLayout, config?: LayoutConfig) {
  layout.clearRoutingDummies();
  Object.entries(layout.edges).forEach(([edgeId, edge]) => {
    if (!edge.original) {
      delete layout.edges[edgeId];
    } else if (edge.reversed) {
      edge.source = edge.originalSource;
      edge.target = edge.originalTarget;
      edge.reversed = false;
    }
  });

  const grid = buildRoutingGrid(layout, config);
  const sortableEdges = Object.values(layout.edges).filter((edge) => edge.original && !edge.reversed);

  sortableEdges.sort((a, b) => {
    const spanA = (a.maxLayer - a.minLayer) * 1000 + Math.abs(a.weight ?? 0);
    const spanB = (b.maxLayer - b.minLayer) * 1000 + Math.abs(b.weight ?? 0);
    return spanA - spanB;
  });

  sortableEdges.forEach((edge) => {
    const routed = routeEdgeWithLee(layout, edge.id, grid, config);
    if (!routed) {
      buildStraightPolyline(layout, edge.id);
    }
  });

  layout.invalidateSegments();
}
