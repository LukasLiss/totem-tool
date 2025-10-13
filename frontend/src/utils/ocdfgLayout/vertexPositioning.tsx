import { ACTIVITY_TYPE, DUMMY_TYPE, OCDFGLayout } from './LayoutState';
import type { LayoutConfig } from './LayoutState';

type CoordMap = { [key: string]: number | undefined };

export function positionVertices(layout: OCDFGLayout, config: LayoutConfig) {
  layout.direction = config.direction;
  markType1Conflicts(layout);
  const candidateLayouts: CoordMap[] = [];

  const clones = () => layout.layering.map((layer) => [...layer]);

  for (const verticalDir of [0, 1]) {
    for (const horizontalDir of [0, 1]) {
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
        const delta = minimalSeparation(layout, config);
        shift[sink[u]] = Math.min(shift[sink[u]], (x[nodeId] ?? 0) - (x[u] ?? 0) - delta);
      } else {
        const delta = minimalSeparation(layout, config);
        x[nodeId] = Math.max(x[nodeId] ?? 0, (x[u] ?? 0) + delta);
      }
    }
    w = aligns[w];
  } while (w !== nodeId);
}

function minimalSeparation(layout: OCDFGLayout, config: LayoutConfig) {
  const width = config.direction === 'TB' ? config.activityWidth : config.activityHeight;
  const dummySize =
    config.direction === 'TB' ? config.dummyWidth : config.dummyHeight;
  return config.vertexSep + Math.max(width, dummySize);
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
  let accumulated = config.borderPadding;

  layering.forEach((layer, layerIndex) => {
    let halfLayerSize = 0;
    layer.forEach((nodeId) => {
      const node = layout.nodes[nodeId];
      if (!node) return;
      const halfSize =
        node.type === ACTIVITY_TYPE
          ? config.direction === 'TB'
            ? config.activityHeight / 2
            : config.activityWidth / 2
          : config.direction === 'TB'
            ? config.dummyHeight / 2
            : config.dummyWidth / 2;
      halfLayerSize = Math.max(halfLayerSize, halfSize);
    });
    layerSizes.push({ layer: layerIndex, size: halfLayerSize * 2 });

    const baseCoord = accumulated + halfLayerSize;

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

      const nodeHalf =
        node.type === ACTIVITY_TYPE
          ? config.direction === 'TB'
            ? config.activityHeight / 2
            : config.activityWidth / 2
          : config.direction === 'TB'
            ? config.dummyHeight / 2
            : config.dummyWidth / 2;

      let primary = median + config.borderPadding;
      let secondary = baseCoord;

      if (node.type === DUMMY_TYPE) {
        if (node.upper && layout.nodes[node.upper]?.type !== DUMMY_TYPE) {
          secondary = baseCoord - halfLayerSize + nodeHalf;
        } else if (node.lower && layout.nodes[node.lower]?.type !== DUMMY_TYPE) {
          secondary = baseCoord + halfLayerSize - nodeHalf;
        }
      }

      if (config.direction === 'TB') {
        node.x = primary;
        node.y = secondary;
      } else {
        node.x = secondary;
        node.y = primary;
      }
    });

    accumulated += halfLayerSize * 2 + config.layerSep;
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
