import type { LayoutConfig, LayoutInitData } from './LayoutState';
import { OCDFGLayout, resetIdCounters } from './LayoutState';
import { reverseCycles } from './cycleBreaking';
import { assignLayers } from './layerAssignment';
import { orderVertices } from './vertexOrdering';
import { positionVertices } from './vertexPositioning';
import { routeEdges } from './edgeRouting';

export type { LayoutConfig, LayoutInitData } from './LayoutState';

export async function sugiyama(init: LayoutInitData, config: LayoutConfig) {
  resetIdCounters();
  const layout = new OCDFGLayout(init);

  const detachedTerminals = layout.detachTerminalNodes();

  reverseCycles(layout, {
    preferredSources: config.preferredSources,
    preferredSinks: config.preferredSinks,
  });

  await assignLayers(layout, config);
  orderVertices(layout, config);
  positionVertices(layout, config);
  routeEdges(layout);
  layout.computeCoreMetrics(config);

  layout.attachTerminalNodes(detachedTerminals, config);
  if (detachedTerminals) {
    routeEdges(layout);
  }

  return layout;
}
