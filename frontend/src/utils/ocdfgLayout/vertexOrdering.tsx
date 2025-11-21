import { ACTIVITY_TYPE, DUMMY_TYPE, OCDFGLayout } from './LayoutState';
import type { LayoutConfig, LayoutNode } from './LayoutState';

const EPS = 1e-6;
const EDGE_LENGTH_WEIGHT = 12;
const TERMINAL_EDGE_FACTOR = 0.2;

export function orderVertices(layout: OCDFGLayout, config: LayoutConfig) {
  const initialLayering = applyObjectCentralityOrdering(
    cloneLayering(layout.layering),
    layout,
    config,
  );
  const optimizedLayering = upDownBarycenterBilayerSweep(layout, initialLayering, config);
  layout.updateLayering(optimizedLayering);

  // DEBUG: Summary of all highway bundles after optimization
  const highwayDummies = Object.values(layout.nodes).filter(
    (node) => node.type === DUMMY_TYPE && node.isInHighwayBundle,
  );
  if (highwayDummies.length > 0) {
    console.log(`[HIGHWAY SUMMARY] ${highwayDummies.length} dummy nodes marked as part of highway bundles`);
    const bundlesByLayer = new Map<number, typeof highwayDummies>();
    highwayDummies.forEach((node) => {
      const existing = bundlesByLayer.get(node.layer) || [];
      existing.push(node);
      bundlesByLayer.set(node.layer, existing);
    });
    bundlesByLayer.forEach((dummies, layer) => {
      console.log(`  Layer ${layer}: ${dummies.length} highway dummies`);
    });
  }
}

function applyObjectCentralityOrdering(
  layering: string[][],
  layout: OCDFGLayout,
  config: LayoutConfig,
) {
  const mapping = config.objectCentrality;
  if (!mapping) {
    return layering;
  }

  const orderLookup = layering.map((layer) => new Map(layer.map((id, idx) => [id, idx])));

  return layering.map((layer, layerIndex) => {
    return [...layer].sort((a, b) => {
      const aScore = mapping[getPrimaryObjectType(layout.nodes[a])] ?? Number.POSITIVE_INFINITY;
      const bScore = mapping[getPrimaryObjectType(layout.nodes[b])] ?? Number.POSITIVE_INFINITY;
      if (aScore === bScore) {
        return (orderLookup[layerIndex].get(a) ?? 0) - (orderLookup[layerIndex].get(b) ?? 0);
      }
      return aScore - bScore;
    });
  });
}

function getPrimaryObjectType(node: LayoutNode | undefined) {
  if (!node) return '__default';
  return node.objectTypes[0] ?? '__default';
}

function upDownBarycenterBilayerSweep(
  layout: OCDFGLayout,
  layering: string[][],
  config: LayoutConfig,
) {
  let currentLayering = cloneLayering(layering);
  let bestLayering = cloneLayering(layering);
  let bestScore = computeLayeringScore(layout, bestLayering, config);
  let noImprovementCounter = 0;

  const seen = new Set<string>();
  seen.add(layeringSignature(currentLayering));

  while (noImprovementCounter < config.maxBarycenterIterations) {
    currentLayering = singleUpDownSweep(layout, currentLayering, config);
    const score = computeLayeringScore(layout, currentLayering, config);
    if (score + EPS < bestScore) {
      bestScore = score;
      bestLayering = cloneLayering(currentLayering);
      noImprovementCounter = 0;
    } else {
      noImprovementCounter++;
    }

    const signature = layeringSignature(currentLayering);
    if (seen.has(signature)) {
      break;
    }
    seen.add(signature);
  }

  return bestLayering;
}

function singleUpDownSweep(layout: OCDFGLayout, layering: string[][], config: LayoutConfig) {
  const result = cloneLayering(layering);
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
  const layer = layering[layerIndex];

  // Group nodes that should stay together (dummy nodes sharing segments)
  const bundles = groupSharedSegmentDummies(layout, layer);

  // Compute barycenter for each bundle (using the first node's barycenter)
  const bundleBarycenters = new Map<string, number>();
  bundles.forEach((bundle) => {
    if (bundle.length === 0) return;
    const representativeBarycenter = computeBarycenter(
      layout,
      layering,
      bundle[0],
      layerIndex,
      downward,
      config,
    );
    bundle.forEach((nodeId) => {
      bundleBarycenters.set(nodeId, representativeBarycenter);
    });
  });

  // Compute barycenters for non-bundled nodes
  const barycenters = new Map<string, number>();
  layer.forEach((nodeId) => {
    if (bundleBarycenters.has(nodeId)) {
      barycenters.set(nodeId, bundleBarycenters.get(nodeId)!);
    } else {
      barycenters.set(
        nodeId,
        computeBarycenter(layout, layering, nodeId, layerIndex, downward, config),
      );
    }
  });

  const originalOrder = new Map<string, number>();
  layer.forEach((nodeId, idx) => originalOrder.set(nodeId, idx));

  // Sort while keeping bundle members together
  const sortedLayer = [...layer].sort((a, b) => {
    const diff = (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0);
    if (Math.abs(diff) > EPS) return diff;

    // If same barycenter, check if they're in the same bundle
    const bundleA = bundles.find((bundle) => bundle.includes(a));
    const bundleB = bundles.find((bundle) => bundle.includes(b));

    if (bundleA && bundleB && bundleA === bundleB) {
      // Maintain order within bundle
      return bundleA.indexOf(a) - bundleA.indexOf(b);
    }

    return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
  });

  return sortedLayer;
}

function groupSharedSegmentDummies(layout: OCDFGLayout, layer: string[]): string[][] {
  const bundles: string[][] = [];
  const assigned = new Set<string>();

  // Find dummy nodes and group them by shared segments
  const dummyNodes = layer.filter((nodeId) => {
    const node = layout.nodes[nodeId];
    return node && node.type === DUMMY_TYPE;
  });

  dummyNodes.forEach((nodeId) => {
    if (assigned.has(nodeId)) return;

    const node = layout.nodes[nodeId];
    if (!node) return;

    const segmentKey = `${node.upper || 'null'}->${node.lower || 'null'}`;

    // Find all dummies sharing this segment
    const bundleMembers = dummyNodes.filter((candidateId) => {
      const candidate = layout.nodes[candidateId];
      if (!candidate) return false;
      const candidateSegmentKey = `${candidate.upper || 'null'}->${candidate.lower || 'null'}`;
      return candidateSegmentKey === segmentKey;
    });

    if (bundleMembers.length > 1) {
      // Sort by edge ID for consistent ordering
      bundleMembers.sort((a, b) => {
        const edgeA = layout.nodes[a]?.belongsTo || '';
        const edgeB = layout.nodes[b]?.belongsTo || '';
        return edgeA.localeCompare(edgeB);
      });

      bundles.push(bundleMembers);
      bundleMembers.forEach((id) => assigned.add(id));

      // DEBUG: Log highway bundle detection
      console.log(`[HIGHWAY BUNDLE DETECTED] Layer ${node.layer}:`, {
        segmentKey,
        bundleSize: bundleMembers.length,
        edges: bundleMembers.map((id) => layout.nodes[id]?.belongsTo).filter(Boolean),
        dummyIds: bundleMembers,
      });

      // Mark nodes as part of highway bundle
      bundleMembers.forEach((id, index) => {
        const dummyNode = layout.nodes[id];
        if (dummyNode) {
          dummyNode.isInHighwayBundle = true;
          dummyNode.bundleIndex = index;
        }
      });
    }
  });

  if (bundles.length > 0) {
    console.log(`[HIGHWAY] Found ${bundles.length} highway bundle(s) in layer with ${layer.length} nodes`);
  }

  return bundles;
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

  // Base position calculation
  let basePosition: number;
  if (!downward && node.lower && layout.nodes[node.lower]?.type !== DUMMY_TYPE) {
    const upperIndex = node.upper ? positionInLayer(layering[layerIndex - 1], node.upper) : index;
    basePosition = (index + upperIndex) / 2 + 1;
  } else {
    basePosition = index + 1;
  }

  // Find other dummy nodes sharing the same segment (upper, lower)
  const currentLayer = layering[layerIndex];
  const segmentKey = `${node.upper || 'null'}->${node.lower || 'null'}`;
  const sharedSegmentDummies = currentLayer.filter((nodeId) => {
    const candidate = layout.nodes[nodeId];
    if (!candidate || candidate.type !== DUMMY_TYPE) return false;
    const candidateSegmentKey = `${candidate.upper || 'null'}->${candidate.lower || 'null'}`;
    return candidateSegmentKey === segmentKey;
  });

  // If this is the only dummy on this segment, return base position
  if (sharedSegmentDummies.length <= 1) {
    return basePosition;
  }

  // Sort shared dummies by their edge ID for consistent ordering
  sharedSegmentDummies.sort((a, b) => {
    const edgeA = layout.nodes[a]?.belongsTo || '';
    const edgeB = layout.nodes[b]?.belongsTo || '';
    return edgeA.localeCompare(edgeB);
  });

  // Find this dummy's index within the shared segment group
  const dummyIndex = sharedSegmentDummies.indexOf(node.id);
  if (dummyIndex === -1) return basePosition;

  // Calculate offset: spread dummies around the base position
  // Use small increments (0.1) to keep them close together like highway lanes
  const numDummies = sharedSegmentDummies.length;
  const spreadFactor = 0.15; // Controls how far apart parallel edges are
  const offset = (dummyIndex - (numDummies - 1) / 2) * spreadFactor;

  return basePosition + offset;
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
  let weightSum = 0;
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
    const sourceVariant = layout.nodes[edge.source]?.variant;
    const targetVariant = layout.nodes[edge.target]?.variant;
    const isTerminalEdge =
      sourceVariant === 'start' ||
      sourceVariant === 'end' ||
      targetVariant === 'start' ||
      targetVariant === 'end';
    const weight = isTerminalEdge ? TERMINAL_EDGE_FACTOR : 1;
    total += weight * (verticalComponent + horizontalComponent);
    weightSum += weight;
  });

  return weightSum === 0 ? 0 : total / weightSum;
}

function cloneLayering(layering: string[][]) {
  return layering.map((layer) => [...layer]);
}

function layeringSignature(layering: string[][]) {
  return layering.map((layer) => layer.join(',')).join('|');
}
