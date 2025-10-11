import { DUMMY_TYPE, generateDummyId, generateEdgeId, OCDFGLayout } from './LayoutState';
import type { LayoutNode } from './LayoutState';

export function insertDummyNodes(layout: OCDFGLayout) {
  layout.layering = layout.layering.map((layer) => [...layer]);

  Object.values(layout.edges).forEach((edge) => {
    const sourceNode = layout.nodes[edge.source];
    const targetNode = layout.nodes[edge.target];
    if (!sourceNode || !targetNode) return;

    const sourceLayer = sourceNode.layer;
    const targetLayer = targetNode.layer;
    edge.minLayer = Math.min(sourceLayer, targetLayer);
    edge.maxLayer = Math.max(sourceLayer, targetLayer);

    const slack = edge.maxLayer - edge.minLayer;
    edge.path = [];

    if (slack <= 1) {
      return;
    }

    const dummies: LayoutNode[] = [];
    let previous = edge.source;

    for (let i = 1; i < slack; i++) {
      const currentLayerIndex = sourceLayer + i;
      ensureLayer(layout, currentLayerIndex);
      const dummyId = generateDummyId();
      const dummy: LayoutNode = {
        id: dummyId,
        label: '',
        objectTypes: [...edge.owners],
        type: DUMMY_TYPE,
        layer: currentLayerIndex,
        pos: -1,
        x: undefined,
        y: undefined,
        belongsTo: edge.id,
        upper: previous,
        lower: undefined,
      };
      layout.addDummyNode(dummy);

      const insertIndex = computeInsertIndex(layout, currentLayerIndex, previous, edge.target);
      layout.layering[currentLayerIndex].splice(insertIndex, 0, dummyId);

      layout.nodes[previous].lower = dummyId;
      previous = dummyId;
      dummies.push(dummy);
      edge.path.push(dummyId);
    }

    layout.nodes[previous].lower = edge.target;
    edge.path.forEach((dummyId, idx) => {
      const dummy = layout.nodes[dummyId];
      if (!dummy) return;
      dummy.upper = idx === 0 ? edge.source : edge.path[idx - 1];
      dummy.lower = idx === edge.path.length - 1 ? edge.target : edge.path[idx + 1];
    });

    // Add helper edges for conflict detection.
    if (edge.path.length > 0) {
      const firstDummy = edge.path[0];
      const lastDummy = edge.path[edge.path.length - 1];

      const helperEdge1Id = generateEdgeId();
      layout.addEdge({
        id: helperEdge1Id,
        source: edge.source,
        target: firstDummy,
        originalSource: edge.source,
        originalTarget: firstDummy,
        reversed: edge.reversed,
        owners: [...edge.owners],
        weight: edge.weight,
        path: [],
        minLayer: sourceLayer,
        maxLayer: sourceLayer + 1,
        original: false,
        type1: false,
      });

      const helperEdge2Id = generateEdgeId();
      layout.addEdge({
        id: helperEdge2Id,
        source: lastDummy,
        target: edge.target,
        originalSource: lastDummy,
        originalTarget: edge.target,
        reversed: edge.reversed,
        owners: [...edge.owners],
        weight: edge.weight,
        path: [],
        minLayer: targetLayer - 1,
        maxLayer: targetLayer,
        original: false,
        type1: false,
      });
    }
  });

  layout.updateLayering(layout.layering);
}

function ensureLayer(layout: OCDFGLayout, layerIndex: number) {
  if (!layout.layering[layerIndex]) {
    layout.layering[layerIndex] = [];
  }
}

function computeInsertIndex(
  layout: OCDFGLayout,
  layerIndex: number,
  upper: string,
  lower: string,
) {
  const layer = layout.layering[layerIndex];
  const upperLayer = layout.nodes[upper]?.layer ?? 0;
  const lowerLayer = layout.nodes[lower]?.layer ?? 0;
  const upperIndex = layout.layering[upperLayer]?.indexOf(upper) ?? 0;
  const lowerIndex = layout.layering[lowerLayer]?.indexOf(lower) ?? layer.length;
  const median = Math.floor((upperIndex + lowerIndex) / 2);
  return Math.min(Math.max(median, 0), layer.length);
}
