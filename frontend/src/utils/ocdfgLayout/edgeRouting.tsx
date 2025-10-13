import { OCDFGLayout, type LayoutPoint } from './LayoutState';

const EPSILON = 1e-6;

function pushPoint(points: LayoutPoint[], point: LayoutPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) {
    return;
  }
  points.push(point);
}

function buildEdgePolyline(layout: OCDFGLayout, edgeId: string) {
  const edge = layout.edges[edgeId];
  if (!edge || edge.reversed) return;

  const nodeIds = [edge.source, ...edge.path, edge.target];
  const polyline: LayoutPoint[] = [];

  nodeIds.forEach((nodeId) => {
    const node = layout.nodes[nodeId];
    if (!node || node.x === undefined || node.y === undefined) {
      return;
    }
    pushPoint(polyline, { x: node.x, y: node.y });
  });

  if (polyline.length >= 2) {
    edge.polyline = polyline;
  } else {
    delete edge.polyline;
  }
}

export function routeEdges(layout: OCDFGLayout) {
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
