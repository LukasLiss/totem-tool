import type { LayoutConfig, LayoutInitData } from './LayoutState';
import { OCDFGLayout, resetIdCounters } from './LayoutState';
import { reverseCycles } from './cycleBreaking';
import { assignLayers } from './layerAssignment';
import { insertDummyNodes } from './dummyNodeInsertion';
import { orderVertices } from './vertexOrdering';
import { positionVertices } from './vertexPositioning';
import { routeEdges } from './edgeRouting';

export type { LayoutConfig, LayoutInitData } from './LayoutState';

export async function sugiyama(init: LayoutInitData, config: LayoutConfig) {
  resetIdCounters();
  const layout = new OCDFGLayout(init);

  reverseCycles(layout, {
    preferredSources: config.preferredSources,
    preferredSinks: config.preferredSinks,
  });

  await assignLayers(layout);
  insertDummyNodes(layout);
  orderVertices(layout, config);
  positionVertices(layout, config);
  routeEdges(layout);

  return layout;
}
