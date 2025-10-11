import { OCDFGLayout } from './LayoutState';

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
  layout.invalidateSegments();
}

