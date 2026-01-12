import { DUMMY_TYPE, OCDFGLayout } from './LayoutState';
import type { LayoutConfig, LayoutNode } from './LayoutState';

type CoordMap = { [key: string]: number | undefined };

export function positionVertices(layout: OCDFGLayout, config: LayoutConfig) {
  layout.direction = config.direction;
  markType1Conflicts(layout);
  const candidateLayouts: CoordMap[] = [];

  const clones = () => layout.layering.map((layer) => [...layer]);

  const alignment = normalizeAlignmentConfig(config);

  for (const verticalDir of alignment.vertical) {
    for (const horizontalDir of alignment.horizontal) {
      const [currentLayering, pos] = transformLayering(clones(), verticalDir, horizontalDir);
      const [roots, aligns] = verticalAlignment(layout, currentLayering, pos, verticalDir === 0);
      const [coords, maxCoord] = horizontalCompaction(
        layout,
        currentLayering,
        roots,
        aligns,
        pos,
        config,
      );
      if (horizontalDir === 1) {
        Object.keys(coords).forEach((key) => {
          if (coords[key] !== undefined) {
            coords[key] = maxCoord - (coords[key] ?? 0);
          }
        });
      }
      candidateLayouts.push(coords);
    }
  }

  alignAssignments(candidateLayouts);
  setCoordinates(layout, layout.layering, candidateLayouts, config);
}

function normalizeAlignmentConfig(config: LayoutConfig) {
  if (!config.seeAlignmentType || !config.alignmentType) {
    return { vertical: [0, 1], horizontal: [0, 1] };
  }

  switch (config.alignmentType) {
    case 'downLeft':
      return { vertical: [0], horizontal: [0] };
    case 'downRight':
      return { vertical: [0], horizontal: [1] };
    case 'upLeft':
      return { vertical: [1], horizontal: [0] };
    case 'upRight':
      return { vertical: [1], horizontal: [1] };
    default:
      return { vertical: [0, 1], horizontal: [0, 1] };
  }
}

function markType1Conflicts(layout: OCDFGLayout) {
  for (let layerIndex = 1; layerIndex < layout.layering.length - 2; layerIndex++) {
    const layer = layout.layering[layerIndex];
    const nextLayer = layout.layering[layerIndex + 1];
    let k0 = 0;
    let l = 0;

    for (let l1 = 0; l1 < nextLayer.length; l1++) {
      if (l1 === nextLayer.length - 1 || isIncidentToInnerSegment(layout, nextLayer[l1])) {
        let k1 = layer.length - 1;
        if (isIncidentToInnerSegment(layout, nextLayer[l1])) {
          const upperNeighbors = getUpperNeighbors(layout, nextLayer[l1]);
          if (upperNeighbors.length > 0) {
            k1 = layer.indexOf(upperNeighbors[0]);
          }
        }

        while (l <= l1) {
          const upperNeighbors = getUpperNeighbors(layout, nextLayer[l]);
          upperNeighbors.forEach((upperNeighbor) => {
            const k = layer.indexOf(upperNeighbor);
            if (k < k0 || k > k1) {
              const arcs = layout.getEdgesBetween(upperNeighbor, nextLayer[l]);
              arcs.forEach((arc) => {
                if (!isIncidentToInnerSegment(layout, upperNeighbor) || !isIncidentToInnerSegment(layout, nextLayer[l])) {
                  arc.type1 = true;
                }
              });
            }
          });
          l++;
        }
        k0 = k1;
      }
    }
  }
}

function transformLayering(layering: string[][], verticalDir: number, horizontalDir: number) {
  if (verticalDir === 1) {
    layering.reverse();
  }
  if (horizontalDir === 1) {
    layering.forEach((layer) => layer.reverse());
  }
  const pos: { [key: string]: number } = {};
  layering.forEach((layer) => {
    layer.forEach((nodeId, index) => {
      pos[nodeId] = index;
    });
  });
  return [layering, pos] as const;
}

function verticalAlignment(
  layout: OCDFGLayout,
  layering: string[][],
  pos: { [key: string]: number },
  down: boolean,
) {
  const root: { [key: string]: string } = {};
  const align: { [key: string]: string } = {};
  layering.forEach((layer) => {
    layer.forEach((nodeId) => {
      root[nodeId] = nodeId;
      align[nodeId] = nodeId;
    });
  });

  for (let i = 1; i < layering.length; i++) {
    const layer = layering[i];
    let r = -1;
    for (let k = 0; k < layer.length; k++) {
      const nodeId = layer[k];
      const neighbors = down ? getUpperNeighbors(layout, nodeId) : getLowerNeighbors(layout, nodeId);
      neighbors.sort((a, b) => pos[a] - pos[b]);
      if (neighbors.length > 0) {
        const medianIndices = Array.from(
          new Set([Math.floor((neighbors.length - 1) / 2), Math.ceil((neighbors.length - 1) / 2)]),
        );
        for (const m of medianIndices) {
          if (align[nodeId] === nodeId) {
            if (!isMarked(layout, neighbors[m], nodeId) && r < pos[neighbors[m]]) {
              align[neighbors[m]] = nodeId;
              root[nodeId] = root[neighbors[m]];
              align[nodeId] = root[nodeId];
              r = pos[neighbors[m]];
            }
          }
        }
      }
    }
  }

  return [root, align] as const;
}

function horizontalCompaction(
  layout: OCDFGLayout,
  layering: string[][],
  roots: { [key: string]: string },
  aligns: { [key: string]: string },
  pos: { [key: string]: number },
  config: LayoutConfig,
) {
  const x: CoordMap = {};
  const sink: { [key: string]: string } = {};
  const shift: { [key: string]: number } = {};

  layering.forEach((layer) => {
    layer.forEach((nodeId) => {
      sink[nodeId] = nodeId;
      shift[nodeId] = Infinity;
      x[nodeId] = undefined;
    });
  });

  layering.forEach((layer) => {
    layer.forEach((nodeId) => {
      if (roots[nodeId] === nodeId) {
        placeBlock(layout, layering, nodeId, x, pos, roots, sink, shift, aligns, config);
      }
    });
  });

  let xMax = 0;
  const absX: CoordMap = {};
  layering.forEach((layer) => {
    layer.forEach((nodeId) => {
      absX[nodeId] = x[roots[nodeId]];
      if (shift[sink[roots[nodeId]]] < Infinity && absX[nodeId] !== undefined) {
        absX[nodeId] = (absX[nodeId] ?? 0) + shift[sink[roots[nodeId]]];
      }
      xMax = Math.max(xMax, absX[nodeId] ?? 0);
    });
  });

  return [absX, xMax] as const;
}

function placeBlock(
  layout: OCDFGLayout,
  layering: string[][],
  nodeId: string,
  x: CoordMap,
  pos: { [key: string]: number },
  roots: { [key: string]: string },
  sink: { [key: string]: string },
  shift: { [key: string]: number },
  aligns: { [key: string]: string },
  config: LayoutConfig,
) {
  if (x[nodeId] !== undefined) return;
  x[nodeId] = 0;
  let w = nodeId;
  do {
    if (pos[w] > 0) {
      const layerIndex = layering.findIndex((layer) => layer.includes(w));
      const predecessor = layering[layerIndex][pos[w] - 1];
      const u = roots[predecessor];
      placeBlock(layout, layering, u, x, pos, roots, sink, shift, aligns, config);
      if (sink[nodeId] === nodeId) {
        sink[nodeId] = sink[u];
      }
      if (sink[nodeId] !== sink[u]) {
        const delta = minimalSeparation(layout, config, nodeId, u);
        shift[sink[u]] = Math.min(shift[sink[u]], (x[nodeId] ?? 0) - (x[u] ?? 0) - delta);
      } else {
        const delta = minimalSeparation(layout, config, nodeId, u);
        x[nodeId] = Math.max(x[nodeId] ?? 0, (x[u] ?? 0) + delta);
      }
    }
    w = aligns[w];
  } while (w !== nodeId);
}

function minimalSeparation(
  layout: OCDFGLayout,
  config: LayoutConfig,
  currentId?: string,
  previousId?: string,
) {
  const currentNode = currentId ? layout.nodes[currentId] : undefined;
  const previousNode = previousId ? layout.nodes[previousId] : undefined;
  const currentHalf = nodePrimaryHalf(currentNode, config);
  const previousHalf = nodePrimaryHalf(previousNode, config);
  return config.vertexSep + currentHalf + previousHalf;
}

function fallbackPrimarySize(node: LayoutNode | undefined, config: LayoutConfig) {
  const isDummy = node?.type === DUMMY_TYPE;
  if (config.direction === 'TB') {
    return isDummy ? config.dummyWidth : config.activityWidth;
  }
  return isDummy ? config.dummyHeight : config.activityHeight;
}

function fallbackSecondarySize(node: LayoutNode | undefined, config: LayoutConfig) {
  const isDummy = node?.type === DUMMY_TYPE;
  if (config.direction === 'TB') {
    return isDummy ? config.dummyHeight : config.activityHeight;
  }
  return isDummy ? config.dummyWidth : config.activityWidth;
}

function nodePrimarySize(node: LayoutNode | undefined, config: LayoutConfig) {
  const fallback = fallbackPrimarySize(node, config);
  if (!node) return fallback;
  const rawSize = config.direction === 'TB' ? node.width : node.height;
  return rawSize && rawSize > 0 ? rawSize : fallback;
}

function nodeSecondarySize(node: LayoutNode | undefined, config: LayoutConfig) {
  const fallback = fallbackSecondarySize(node, config);
  if (!node) return fallback;
  const rawSize = config.direction === 'TB' ? node.height : node.width;
  return rawSize && rawSize > 0 ? rawSize : fallback;
}

function nodePrimaryHalf(node: LayoutNode | undefined, config: LayoutConfig) {
  return nodePrimarySize(node, config) / 2;
}

function nodeSecondaryHalf(node: LayoutNode | undefined, config: LayoutConfig) {
  return nodeSecondarySize(node, config) / 2;
}

function getPrimaryCoord(node: LayoutNode, config: LayoutConfig): number | undefined {
  return config.direction === 'TB' ? node.x : node.y;
}

function setPrimaryCoord(node: LayoutNode, config: LayoutConfig, value: number) {
  if (config.direction === 'TB') {
    node.x = value;
  } else {
    node.y = value;
  }
}

function enforceLayerPrimarySpacing(
  layout: OCDFGLayout,
  layerIds: string[],
  config: LayoutConfig,
) {
  const nodes = layerIds
    .map((id) => layout.nodes[id])
    .filter((node): node is LayoutNode => Boolean(node))
    .filter((node) => getPrimaryCoord(node, config) !== undefined);

  nodes.sort((a, b) => {
    const aCoord = getPrimaryCoord(a, config) ?? 0;
    const bCoord = getPrimaryCoord(b, config) ?? 0;
    return aCoord - bCoord;
  });

  let previousRight = config.borderPadding - config.vertexSep;

  nodes.forEach((node, index) => {
    const primary = getPrimaryCoord(node, config);
    if (primary === undefined) return;

    const half = nodePrimaryHalf(node, config);
    const left = primary - half;
    const minLeft = index === 0 ? config.borderPadding : previousRight + config.vertexSep;

    if (left < minLeft) {
      const shiftedCenter = minLeft + half;
      setPrimaryCoord(node, config, shiftedCenter);
      previousRight = shiftedCenter + half;
    } else {
      previousRight = primary + half;
    }
  });
}

function alignAssignments(layouts: CoordMap[]) {
  const ranges = layouts.map((coords) => {
    const values = Object.values(coords).filter((v): v is number => v !== undefined);
    if (values.length === 0) return { min: 0, max: 0, width: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, width: max - min };
  });

  const minWidthIndex = ranges.reduce((acc, curr, idx, arr) => {
    if (curr.width < arr[acc].width) {
      return idx;
    }
    return acc;
  }, 0);

  layouts.forEach((coords, index) => {
    const range = ranges[index];
    const target = ranges[minWidthIndex];
    const shift = index % 2 === 0 ? range.min - target.min : range.max - target.max;
    Object.keys(coords).forEach((key) => {
      if (coords[key] !== undefined) {
        coords[key] = coords[key]! + shift;
      }
    });
  });
}

function setCoordinates(
  layout: OCDFGLayout,
  layering: string[][],
  layouts: CoordMap[],
  config: LayoutConfig,
) {
  const layerSizes: { layer: number; size: number }[] = [];

  // Use standard activity node size for consistent layer spacing
  // This ensures all layers have the same spacing regardless of node types
  const standardSecondarySize = config.direction === 'TB' ? config.activityHeight : config.activityWidth;
  const standardSecondaryHalf = standardSecondarySize / 2;

  let accumulated = config.borderPadding;

  layering.forEach((layer, layerIndex) => {
    // Use the standard size for consistent layer spacing across all layers
    const maxSecondaryHalf = standardSecondaryHalf;
    layerSizes.push({ layer: layerIndex, size: maxSecondaryHalf * 2 });

    const baseCoord = accumulated + maxSecondaryHalf;
    let previousPrimaryCenter: number | undefined;
    let previousPrimaryHalf = 0;

    layer.forEach((nodeId) => {
      const candidates = layouts
        .map((coords) => coords[nodeId])
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => a - b);
      let median = 0;
      if (candidates.length === 1) {
        median = candidates[0];
      } else if (candidates.length > 1) {
        const middle = Math.floor((candidates.length - 1) / 2);
        const upper = Math.ceil((candidates.length - 1) / 2);
        median = (candidates[middle] + candidates[upper]) / 2;
      }
      const node = layout.nodes[nodeId];
      if (!node) return;

      const primaryHalf = nodePrimaryHalf(node, config);
      const secondaryHalf = nodeSecondaryHalf(node, config);
      let primary = median + config.borderPadding;
      const minPrimary = config.borderPadding + primaryHalf;
      if (primary < minPrimary) {
        primary = minPrimary;
      }

      if (previousPrimaryCenter !== undefined) {
        const requiredSpacing = previousPrimaryHalf + primaryHalf + config.vertexSep;
        const actualSpacing = primary - previousPrimaryCenter;
        if (actualSpacing < requiredSpacing) {
          primary = previousPrimaryCenter + requiredSpacing;
        }
      }

      let secondary = baseCoord;

      if (node.type === DUMMY_TYPE) {
        if (node.upper && layout.nodes[node.upper]?.type !== DUMMY_TYPE) {
          secondary = baseCoord - maxSecondaryHalf + secondaryHalf;
        } else if (node.lower && layout.nodes[node.lower]?.type !== DUMMY_TYPE) {
          secondary = baseCoord + maxSecondaryHalf - secondaryHalf;
        }
      }

      if (config.direction === 'TB') {
        node.x = primary;
        node.y = secondary;
      } else {
        node.x = secondary;
        node.y = primary;
      }

      previousPrimaryCenter = config.direction === 'TB' ? node.x : node.y;
      previousPrimaryHalf = primaryHalf;
    });

    enforceLayerPrimarySpacing(layout, layer, config);

    accumulated += maxSecondaryHalf * 2 + config.layerSep;
  });

  layout.layerSizes = layerSizes;
}

function isMarked(layout: OCDFGLayout, u: string, v: string) {
  const edges = layout.getEdgesBetween(u, v);
  return edges.length > 0 && edges[0].type1;
}

function isIncidentToInnerSegment(layout: OCDFGLayout, nodeId: string) {
  const node = layout.nodes[nodeId];
  if (!node || node.type !== DUMMY_TYPE) return false;
  if (!node.upper) return false;
  const upper = layout.nodes[node.upper];
  return upper?.type === DUMMY_TYPE;
}

function getUpperNeighbors(layout: OCDFGLayout, nodeId: string) {
  return layout.getUpperNeighbors(nodeId);
}

function getLowerNeighbors(layout: OCDFGLayout, nodeId: string) {
  return layout.getLowerNeighbors(nodeId);
}
