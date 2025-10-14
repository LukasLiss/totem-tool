import { ACTIVITY_TYPE, DUMMY_TYPE, OCDFGLayout } from './LayoutState';
import type { LayoutConfig, LayoutNode } from './LayoutState';

const EPS = 1e-6;
const EDGE_LENGTH_WEIGHT = 0.12;

export function orderVertices(layout: OCDFGLayout, config: LayoutConfig) {
  let layering = cloneLayering(layout.layering);
  let bestLayering = cloneLayering(layering);
  let bestScore = computeLayeringScore(layout, bestLayering, config);
  let noImprovementCounter = 0;

  const seen = new Set<string>();
  seen.add(layeringSignature(layering));

  while (noImprovementCounter < config.maxBarycenterIterations) {
    layering = singleSweep(layout, layering, config);
    const score = computeLayeringScore(layout, layering, config);
    if (score + EPS < bestScore) {
      bestScore = score;
      bestLayering = cloneLayering(layering);
      noImprovementCounter = 0;
    } else {
      noImprovementCounter++;
    }

    const signature = layeringSignature(layering);
    if (seen.has(signature)) {
      break;
    }
    seen.add(signature);
  }

  layout.updateLayering(bestLayering);
}

function singleSweep(layout: OCDFGLayout, layering: string[][], config: LayoutConfig) {
  let result = cloneLayering(layering);
  // Downward sweep
  for (let layer = 1; layer < result.length; layer++) {
    result[layer] = reorderLayer(layout, result, layer, true, config);
  }
  // Upward sweep
  for (let layer = result.length - 2; layer >= 0; layer--) {
    result[layer] = reorderLayer(layout, result, layer, false, config);
  }
  return result;
}

function reorderLayer(
  layout: OCDFGLayout,
  layering: string[][],
  layerIndex: number,
  downward: boolean,
  config: LayoutConfig,
) {
  const barycenters = new Map<string, number>();
  layering[layerIndex].forEach((nodeId) => {
    barycenters.set(
      nodeId,
      computeBarycenter(layout, layering, nodeId, layerIndex, downward, config),
    );
  });

  const originalOrder = new Map<string, number>();
  layering[layerIndex].forEach((nodeId, idx) => originalOrder.set(nodeId, idx));

  return [...layering[layerIndex]].sort((a, b) => {
    const diff = (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0);
    if (Math.abs(diff) > EPS) return diff;
    return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
  });
}

function computeBarycenter(
  layout: OCDFGLayout,
  layering: string[][],
  nodeId: string,
  layerIndex: number,
  downward: boolean,
  config: LayoutConfig,
) {
  const node = layout.nodes[nodeId];
  if (!node) return 0;

  if (node.type === DUMMY_TYPE) {
    return dummyBarycenter(layout, layering, node, layerIndex, downward);
  }

  const neighborLayerIndex = downward ? layerIndex - 1 : layerIndex + 1;
  if (neighborLayerIndex < 0 || neighborLayerIndex >= layering.length) {
    return -1;
  }

  const neighbors = downward
    ? layout.getUpperNeighbors(nodeId)
    : layout.getLowerNeighbors(nodeId);

  if (neighbors.length === 0) {
    return -1;
  }

  const base =
    neighbors.reduce(
      (sum, neigh) => sum + (positionInLayer(layering[neighborLayerIndex], neigh) + 1),
      0,
    ) / neighbors.length;

  if (config.objectAttraction <= 0 || node.objectTypes.length === 0) {
    return base;
  }

  const objectPositions = gatherObjectPositions(layout, layering, node, layerIndex, downward, config);
  if (objectPositions.length === 0) {
    return base;
  }

  const objectAvg =
    objectPositions.reduce((sum, val) => sum + val, 0) / objectPositions.length;

  return (1 - config.objectAttraction) * base + config.objectAttraction * objectAvg;
}

function dummyBarycenter(
  layout: OCDFGLayout,
  layering: string[][],
  node: LayoutNode,
  layerIndex: number,
  downward: boolean,
) {
  if (!node.belongsTo) return -1;
  const neighborId = downward ? node.upper : node.lower;
  if (!neighborId) return -1;
  const neighborLayerIndex = downward ? layerIndex - 1 : layerIndex + 1;
  const neighborLayer = layering[neighborLayerIndex];
  if (!neighborLayer) return -1;
  const index = positionInLayer(neighborLayer, neighborId);
  if (index === -1) return -1;
  if (!downward && node.lower && layout.nodes[node.lower]?.type !== DUMMY_TYPE) {
    const upperIndex = node.upper ? positionInLayer(layering[layerIndex - 1], node.upper) : index;
    return (index + upperIndex) / 2 + 1;
  }
  return index + 1;
}

function gatherObjectPositions(
  layout: OCDFGLayout,
  layering: string[][],
  node: LayoutNode,
  layerIndex: number,
  downward: boolean,
  config: LayoutConfig,
) {
  const positions: number[] = [];
  for (
    let offset = config.objectAttractionRangeMin;
    offset <= config.objectAttractionRangeMax;
    offset++
  ) {
    const checkLayer = layerIndex + offset * (downward ? -1 : 1);
    if (checkLayer < 0 || checkLayer >= layering.length) break;
    layering[checkLayer].forEach((candidateId) => {
      const candidate = layout.nodes[candidateId];
      if (!candidate || candidate.type !== ACTIVITY_TYPE) return;
      if (candidate.objectTypes.some((ot) => node.objectTypes.includes(ot))) {
        positions.push(positionInLayer(layering[checkLayer], candidateId) + 1);
      }
    });
  }
  return positions;
}

function computeLayeringScore(
  layout: OCDFGLayout,
  layering: string[][],
  config: LayoutConfig,
) {
  const crossings = countCrossings(layout, layering);
  const attraction = measureObjectGrouping(layout, layering, config);
  const edgeLengthPenalty = measureEdgeLength(layout, layering, config);
  return crossings + attraction + EDGE_LENGTH_WEIGHT * edgeLengthPenalty;
}

function countCrossings(layout: OCDFGLayout, layering: string[][]) {
  let crossings = 0;
  const segments = layout.collectSegments();
  for (let layerIdx = 0; layerIdx < layering.length - 1; layerIdx++) {
    const currentLayer = layering[layerIdx];
    const nextLayer = layering[layerIdx + 1];
    const layerSegments = segments.filter((segment) => segment.layer === layerIdx);
    for (let i = 0; i < layerSegments.length - 1; i++) {
      for (let j = i + 1; j < layerSegments.length; j++) {
        const a = layerSegments[i];
        const b = layerSegments[j];
        const aUpper = positionInLayer(currentLayer, a.source);
        const aLower = positionInLayer(nextLayer, a.target);
        const bUpper = positionInLayer(currentLayer, b.source);
        const bLower = positionInLayer(nextLayer, b.target);
        if ((aUpper - bUpper) * (aLower - bLower) < 0) {
          crossings++;
        }
      }
    }
  }
  return crossings;
}

const OBJECT_GROUPING_MULTIPLIER = 1.8;

function measureObjectGrouping(
  layout: OCDFGLayout,
  layering: string[][],
  config: LayoutConfig,
) {
  if (config.objectAttraction <= 0) return 0;
  const objectTypes = new Set<string>();
  Object.values(layout.nodes).forEach((node) => {
    if (node.type === ACTIVITY_TYPE) {
      node.objectTypes.forEach((ot) => objectTypes.add(ot));
    }
  });

  let deviation = 0;
  objectTypes.forEach((ot) => {
    const positions: number[] = [];
    layering.forEach((layer) => {
      layer.forEach((nodeId) => {
        const node = layout.nodes[nodeId];
        if (node && node.type === ACTIVITY_TYPE && node.objectTypes.includes(ot)) {
          positions.push(positionInLayer(layer, nodeId) + 1);
        }
      });
    });
    if (positions.length > 0) {
      const avg = positions.reduce((sum, val) => sum + val, 0) / positions.length;
      deviation += positions.reduce((sum, val) => sum + Math.abs(val - avg), 0);
    }
  });

  return deviation * config.objectAttraction * OBJECT_GROUPING_MULTIPLIER;
}

function positionInLayer(layer: string[], nodeId: string) {
  const index = layer.indexOf(nodeId);
  return index >= 0 ? index : layer.length;
}

function measureEdgeLength(
  layout: OCDFGLayout,
  layering: string[][],
  config: LayoutConfig,
) {
  const indexLookup = new Map<string, { layer: number; order: number }>();
  layering.forEach((layer, layerIndex) => {
    layer.forEach((nodeId, order) => {
      indexLookup.set(nodeId, { layer: layerIndex, order });
    });
  });

  let total = 0;
  let count = 0;
  Object.values(layout.edges).forEach((edge) => {
    if (!edge.original) return;
    const sourceIndex = indexLookup.get(edge.source);
    const targetIndex = indexLookup.get(edge.target);
    if (!sourceIndex || !targetIndex) return;

    const layerDiff = Math.abs(sourceIndex.layer - targetIndex.layer);
    const orderDiff = Math.abs(sourceIndex.order - targetIndex.order);

    const sourceWidth = layout.nodes[edge.source]?.width ?? config.activityWidth;
    const targetWidth = layout.nodes[edge.target]?.width ?? config.activityWidth;
    const averageWidth = (sourceWidth + targetWidth) / 2;

    const verticalComponent = layerDiff * config.layerSep;
    const horizontalComponent = orderDiff * (averageWidth + config.vertexSep);
    total += verticalComponent + horizontalComponent;
    count++;
  });

  return count === 0 ? 0 : total / count;
}

function cloneLayering(layering: string[][]) {
  return layering.map((layer) => [...layer]);
}

function layeringSignature(layering: string[][]) {
  return layering.map((layer) => layer.join(',')).join('|');
}
