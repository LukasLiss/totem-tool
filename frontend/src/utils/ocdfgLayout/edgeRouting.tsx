import { OCDFGLayout, type LayoutNode, type LayoutPoint } from './LayoutState';

const EPSILON = 1e-6;

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

function buildEdgePolyline(layout: OCDFGLayout, edgeId: string) {
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
