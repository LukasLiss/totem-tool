import { DUMMY_TYPE, OCDFGLayout, type LayoutNode, type LayoutPoint } from './LayoutState';

const EPSILON = 1e-6;
const OUTER_GAP = 28;

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

  if (absDx < 1e-6 && absDy < 1e-6) {
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

function createOuterPoint(
  node: LayoutNode,
  directionSign: number,
  orientation: OCDFGLayout['direction'],
): LayoutPoint {
  const width = node.width || OCDFGLayout.DEFAULT_WIDTH;
  const height = node.height || OCDFGLayout.DEFAULT_HEIGHT;
  const centerX = node.x ?? 0;
  const centerY = node.y ?? 0;
  const safeGap = OUTER_GAP;

  if (orientation === 'TB') {
    const offset = (height / 2) + safeGap;
    return {
      x: centerX,
      y: centerY + directionSign * offset,
    };
  }

  const offset = (width / 2) + safeGap;
  return {
    x: centerX + directionSign * offset,
    y: centerY,
  };
}

function connectWithOrthogonal(
  points: LayoutPoint[],
  target: LayoutPoint,
  orientation: OCDFGLayout['direction'],
  horizontalFirst: boolean,
) {
  const current = points[points.length - 1];
  if (!current) {
    pushPoint(points, target);
    return;
  }

  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.abs(dx) < EPSILON || Math.abs(dy) < EPSILON) {
    pushPoint(points, target);
    return;
  }

  let firstHop: LayoutPoint;
  if (orientation === 'TB') {
    firstHop = horizontalFirst
      ? { x: target.x, y: current.y }
      : { x: current.x, y: target.y };
  } else {
    firstHop = horizontalFirst
      ? { x: current.x, y: target.y }
      : { x: target.x, y: current.y };
  }

  if (Math.abs(firstHop.x - current.x) > EPSILON || Math.abs(firstHop.y - current.y) > EPSILON) {
    pushPoint(points, firstHop);
  }
  pushPoint(points, target);
}

function buildEdgePolyline(layout: OCDFGLayout, edgeId: string) {
  const edge = layout.edges[edgeId];
  if (!edge || edge.reversed) return;

  const sourceCenter = getCenter(layout, edge.source);
  const targetCenter = getCenter(layout, edge.target);
  const sourceNode = layout.nodes[edge.source];
  const targetNode = layout.nodes[edge.target];
  if (!sourceCenter || !targetCenter || !sourceNode || !targetNode) {
    delete edge.polyline;
    return;
  }

  const pathPoints: LayoutPoint[] = [];

  const orientation = layout.direction;
  const travelSign = orientation === 'TB'
    ? Math.sign(targetCenter.y - sourceCenter.y || 1)
    : Math.sign(targetCenter.x - sourceCenter.x || 1);

  const startOuter = createOuterPoint(layout.nodes[edge.source], travelSign || 1, orientation);
  const startBoundary = projectFromNode(sourceNode, startOuter, 0);

  const startDummyId = `__route_start_${edgeId}`;
  const startDummyNode: LayoutNode = {
    id: startDummyId,
    label: '',
    objectTypes: [...sourceNode.objectTypes],
    type: DUMMY_TYPE,
    layer: sourceNode.layer,
    pos: -1,
    x: startOuter.x,
    y: startOuter.y,
    width: 0,
    height: 0,
    belongsTo: edgeId,
    upper: edge.source,
    lower: edge.path.length > 0 ? edge.path[0] : edge.target,
    routeVirtual: true,
  };

  pushPoint(pathPoints, startBoundary);
  pushPoint(pathPoints, startOuter);

  const dummyCenters = edge.path
    .map((dummyId) => getCenter(layout, dummyId))
    .filter((point): point is LayoutPoint => point !== null);

  if (edge.path.length > 0) {
    dummyCenters.forEach((dummyCenter, index) => {
      connectWithOrthogonal(pathPoints, dummyCenter, orientation, index === 0);
    });
  }

  const approachSign = orientation === 'TB'
    ? -Math.sign(targetCenter.y - sourceCenter.y || 1)
    : -Math.sign(targetCenter.x - sourceCenter.x || 1);

  const endOuter = createOuterPoint(layout.nodes[edge.target], approachSign || -1, orientation);
  const endBoundary = projectFromNode(targetNode, endOuter, 0);

  const endDummyId = `__route_end_${edgeId}`;
  const endDummyNode: LayoutNode = {
    id: endDummyId,
    label: '',
    objectTypes: [...targetNode.objectTypes],
    type: DUMMY_TYPE,
    layer: targetNode.layer,
    pos: -1,
    x: endOuter.x,
    y: endOuter.y,
    width: 0,
    height: 0,
    belongsTo: edgeId,
    upper: edge.path.length > 0 ? edge.path[edge.path.length - 1] : edge.source,
    lower: edge.target,
    routeVirtual: true,
  };

  connectWithOrthogonal(
    pathPoints,
    endOuter,
    orientation,
    dummyCenters.length === 0,
  );
  pushPoint(pathPoints, endBoundary);

  if (pathPoints.length >= 2) {
    edge.polyline = pathPoints;
  } else {
    delete edge.polyline;
  }

  layout.nodes[startDummyId] = startDummyNode;
  layout.nodes[endDummyId] = endDummyNode;
  layout.routingDummies[edgeId] = { startId: startDummyId, endId: endDummyId };
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
  });

  Object.keys(layout.edges).forEach((edgeId) => buildEdgePolyline(layout, edgeId));

  layout.invalidateSegments();
}
