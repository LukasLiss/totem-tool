/**
 * Column layout of the process-area hierarchy, moved unchanged out of
 * `TotemVisualizer.tsx` so it can run in a Web Worker (see `useGridLayout`).
 * The parameter types name only the fields the layout reads; callers pass
 * their full layers and edges.
 */

export type GridLayer = {
  level: number;
  areas: Array<{ id: string; objectTypes: string[] }>;
};

export type GridEdge = {
  from: string;
  to: string;
};

type LevelNodeDescriptor = {
  id: string;
  areaId: string;
  orderHint: number;
  levelKey: number;
  levelIndex: number;
};

export type LayoutInfo = {
  nodeColumns: Record<string, number>;
  areaPlacements: Record<
    string,
    {
      startColumn: number;
      span: number;
    }
  >;
  totalColumns: number;
};

function buildNeighbourMap(edges: GridEdge[]): Map<string, Set<string>> {
  const neighbourMap = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (!neighbourMap.has(edge.from)) neighbourMap.set(edge.from, new Set());
    if (!neighbourMap.has(edge.to)) neighbourMap.set(edge.to, new Set());
    neighbourMap.get(edge.from)!.add(edge.to);
    neighbourMap.get(edge.to)!.add(edge.from);
  });
  return neighbourMap;
}

function countIntermediateObstacles(
  edge: GridEdge,
  columns: Record<string, number>,
  nodeLevelIndex: Map<string, number>,
  nodesByLevelIndex: Map<number, string[]>,
): number {
  const sourceLevel = nodeLevelIndex.get(edge.from);
  const targetLevel = nodeLevelIndex.get(edge.to);
  if (
    sourceLevel === undefined ||
    targetLevel === undefined ||
    sourceLevel === targetLevel
  ) {
    return 0;
  }

  const startLevel = Math.min(sourceLevel, targetLevel);
  const endLevel = Math.max(sourceLevel, targetLevel);
  const startColumn = sourceLevel <= targetLevel ? columns[edge.from] : columns[edge.to];
  const endColumn = sourceLevel <= targetLevel ? columns[edge.to] : columns[edge.from];

  if (startColumn === undefined || endColumn === undefined) {
    return 0;
  }

  const levelSpan = endLevel - startLevel;
  if (levelSpan <= 0) {
    return 0;
  }

  let intersections = 0;
  for (let levelIndex = startLevel + 1; levelIndex < endLevel; levelIndex += 1) {
    const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
    if (nodesAtLevel.length === 0) continue;
    const ratio = (levelIndex - startLevel) / levelSpan;
    const interpolatedColumn = startColumn + (endColumn - startColumn) * ratio;
    nodesAtLevel.forEach((nodeId) => {
      if (nodeId === edge.from || nodeId === edge.to) return;
      const nodeColumn = columns[nodeId];
      if (nodeColumn === undefined) return;
      if (Math.abs(nodeColumn - interpolatedColumn) < 0.45) {
        intersections += 1;
      }
    });
  }

  return intersections;
}

type AdjustmentDirection = 'top-down' | 'bottom-up';

function adjustPositionsForLevel(
  descriptors: LevelNodeDescriptor[],
  positions: Map<string, number>,
  neighbourMap: Map<string, Set<string>>,
  nodeLevelIndex: Map<string, number>,
  direction: AdjustmentDirection,
) {
  if (descriptors.length === 0) return;

  const spacing = 1;
  const candidates = descriptors.map((descriptor, index) => {
    const neighbours = neighbourMap.get(descriptor.id);
    const neighbourPositions = neighbours
      ? Array.from(neighbours)
          .map((neighbour) => positions.get(neighbour))
          .filter((value): value is number => value !== undefined && Number.isFinite(value))
      : [];
    let weightedSum = 0;
    let totalWeight = 0;
    neighbours?.forEach((neighbour) => {
      const neighbourPosition = positions.get(neighbour);
      if (neighbourPosition === undefined) return;
      const neighbourLevelIndex = nodeLevelIndex.get(neighbour);
      if (neighbourLevelIndex === undefined) return;
      const levelDelta = neighbourLevelIndex - descriptor.levelIndex;
      if (direction === 'top-down' && levelDelta >= 0) return;
      if (direction === 'bottom-up' && levelDelta <= 0) return;
      const distance = Math.abs(levelDelta) || 1;
      let weight = 1 / distance;
      if (direction === 'top-down') {
        weight *= 1.6;
      }
      weightedSum += neighbourPosition * weight;
      totalWeight += weight;
    });

    const desired =
      totalWeight > 0
        ? weightedSum / totalWeight
        : neighbourPositions.length > 0
          ? neighbourPositions.reduce((acc, value) => acc + value, 0) / neighbourPositions.length
          : positions.get(descriptor.id) ?? index;

    return { descriptor, desired, index };
  });

  candidates.sort((a, b) => {
    if (a.desired === b.desired) {
      return a.descriptor.orderHint - b.descriptor.orderHint;
    }
    return a.desired - b.desired;
  });

  let current = Number.NEGATIVE_INFINITY;
  candidates.forEach((entry) => {
    const desired = Number.isFinite(entry.desired) ? entry.desired : entry.index;
    current = Math.max(current + spacing, desired);
    positions.set(entry.descriptor.id, current);
  });
}

export function prepareGridLayout(layers: GridLayer[], edges: GridEdge[]): LayoutInfo {
  const levelNodeMap = new Map<number, LevelNodeDescriptor[]>();
  const neighbourMap = buildNeighbourMap(edges);
  const nodeLevelIndex = new Map<string, number>();
  const nodesByLevelIndex = new Map<number, string[]>();
  const levelOrder = layers.map((layer) => layer.level);

  let orderHintCounter = 0;

  layers.forEach((layer, layerIndex) => {
    const levelNodes: LevelNodeDescriptor[] = levelNodeMap.get(layer.level) ?? [];
    if (!nodesByLevelIndex.has(layerIndex)) {
      nodesByLevelIndex.set(layerIndex, []);
    }
    layer.areas.forEach((area) => {
      area.objectTypes.forEach((objectType) => {
        levelNodes.push({
          id: objectType,
          areaId: area.id,
          orderHint: orderHintCounter,
          levelKey: layer.level,
          levelIndex: layerIndex,
        });
        nodeLevelIndex.set(objectType, layerIndex);
        nodesByLevelIndex.get(layerIndex)!.push(objectType);
        orderHintCounter += 1;
      });
    });
    levelNodeMap.set(layer.level, levelNodes);
  });

  const positions = new Map<string, number>();
  levelNodeMap.forEach((nodes) => {
    nodes.forEach((descriptor, index) => {
      positions.set(descriptor.id, index);
    });
  });

  const iterations = levelOrder.length > 1 ? 5 : 1;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 1; i < levelOrder.length; i += 1) {
      const levelKey = levelOrder[i];
      const descriptors = levelNodeMap.get(levelKey) ?? [];
      adjustPositionsForLevel(descriptors, positions, neighbourMap, nodeLevelIndex, 'top-down');
    }

    for (let i = levelOrder.length - 2; i >= 0; i -= 1) {
      const levelKey = levelOrder[i];
      const descriptors = levelNodeMap.get(levelKey) ?? [];
      adjustPositionsForLevel(descriptors, positions, neighbourMap, nodeLevelIndex, 'bottom-up');
    }
  }

  levelOrder.forEach((levelKey) => {
    const descriptors = levelNodeMap.get(levelKey) ?? [];
    const ordered = descriptors
      .slice()
      .sort((a, b) => {
        const posA = positions.get(a.id) ?? 0;
        const posB = positions.get(b.id) ?? 0;
        if (posA === posB) {
          return a.orderHint - b.orderHint;
        }
        return posA - posB;
      });

    let last = Number.NEGATIVE_INFINITY;
    ordered.forEach((descriptor) => {
      const raw = positions.get(descriptor.id) ?? 0;
      let column = Math.round(raw);
      if (!Number.isFinite(column)) column = 0;
      if (column <= last) column = last + 1;
      positions.set(descriptor.id, column);
      last = column;
    });
  });

  const allValues = Array.from(positions.values());
  const minColumn = allValues.length > 0 ? Math.min(...allValues) : 0;
  if (Number.isFinite(minColumn) && minColumn !== 0) {
    positions.forEach((value, key) => {
      positions.set(key, value - minColumn);
    });
  }

  const nodeColumns: Record<string, number> = {};
  positions.forEach((value, key) => {
    nodeColumns[key] = value;
  });

  // Build a map of nodeId -> areaId for routing complexity evaluation
  const nodeAreaMap = new Map<string, string>();
  layers.forEach((layer) => {
    layer.areas.forEach((area) => {
      area.objectTypes.forEach((objectType) => {
        nodeAreaMap.set(objectType, area.id);
      });
    });
  });

  // Build a map of levelIndex -> areas at that level (for area crossing detection)
  const areasByLevel = new Map<number, Array<{ id: string; nodeIds: string[] }>>();
  layers.forEach((layer, layerIndex) => {
    const areasAtLevel: Array<{ id: string; nodeIds: string[] }> = [];
    layer.areas.forEach((area) => {
      if (area.objectTypes.length > 0) {
        areasAtLevel.push({ id: area.id, nodeIds: area.objectTypes });
      }
    });
    areasByLevel.set(layerIndex, areasAtLevel);
  });

  const evaluateCrossings = (columns: Record<string, number>) => {
    let total = 0;
    edges.forEach((edge) => {
      // Count intermediate node obstacles - high penalty (3.0 per node crossed)
      total += countIntermediateObstacles(edge, columns, nodeLevelIndex, nodesByLevelIndex) * 0.0;

      const sourceLevel = nodeLevelIndex.get(edge.from);
      const targetLevel = nodeLevelIndex.get(edge.to);
      const sourceCol = columns[edge.from];
      const targetCol = columns[edge.to];
      const sourceArea = nodeAreaMap.get(edge.from);
      const targetArea = nodeAreaMap.get(edge.to);

      if (
        sourceLevel !== undefined &&
        targetLevel !== undefined &&
        sourceCol !== undefined &&
        targetCol !== undefined &&
        sourceLevel !== targetLevel
      ) {
        const minCol = Math.min(sourceCol, targetCol);
        const maxCol = Math.max(sourceCol, targetCol);
        const minLevel = Math.min(sourceLevel, targetLevel);
        const maxLevel = Math.max(sourceLevel, targetLevel);

        // Check for AREA crossings at intermediate levels
        // This penalizes layouts where edges would have to route around process areas
        for (let level = minLevel + 1; level < maxLevel; level++) {
          const areasAtLevel = areasByLevel.get(level) ?? [];
          for (const area of areasAtLevel) {
            // Skip if this is the source or target's area
            if (area.id === sourceArea || area.id === targetArea) continue;

            // Compute the area's column span based on its nodes' current columns
            const areaCols = area.nodeIds
              .map((nodeId) => columns[nodeId])
              .filter((c): c is number => c !== undefined);
            if (areaCols.length === 0) continue;

            const areaMinCol = Math.min(...areaCols);
            const areaMaxCol = Math.max(...areaCols);

            // Check if the edge's column range overlaps with this area's column range
            // If so, the edge would have to cross through this area
            if (maxCol >= areaMinCol && minCol <= areaMaxCol) {
              // Calculate overlap extent - penalty scales with how much of area is crossed
              const overlapStart = Math.max(minCol, areaMinCol);
              const overlapEnd = Math.min(maxCol, areaMaxCol);
              const overlapExtent = overlapEnd - overlapStart + 1;

              // Base penalty of 1.0, plus 0.5 per column of overlap
              // Crossing more of an area = higher penalty
              total += 1.0 + overlapExtent * 0.5;
            }
          }
        }

        // Additional penalty for cross-area edges with blocking nodes
        if (sourceArea !== targetArea) {
          const colDiff = Math.abs(sourceCol - targetCol);
          let hasBlockingNode = false;
          for (let level = minLevel + 1; level < maxLevel; level++) {
            const nodesAtLevel = nodesByLevelIndex.get(level) ?? [];
            for (const nodeId of nodesAtLevel) {
              if (nodeId === edge.from || nodeId === edge.to) continue;
              const nodeCol = columns[nodeId];
              if (nodeCol !== undefined && nodeCol >= minCol && nodeCol <= maxCol) {
                hasBlockingNode = true;
                break;
              }
            }
            if (hasBlockingNode) break;
          }

          if (hasBlockingNode && colDiff > 0) {
            total += colDiff * 0.4;
          }
        }
        // Penalize horizontal edge length to prefer shorter, more vertical paths
        if (sourceCol !== undefined && targetCol !== undefined) {
          total += Math.abs(sourceCol - targetCol) * 0.05;
        }
      }
    });

    // Penalize empty columns (gaps) inside process areas to keep nodes compact
    areasByLevel.forEach((areas) => {
      areas.forEach((area) => {
        const areaCols = area.nodeIds
          .map((nodeId) => columns[nodeId])
          .filter((c): c is number => c !== undefined);
        if (areaCols.length > 0) {
          const minCol = Math.min(...areaCols);
          const maxCol = Math.max(...areaCols);
          const span = maxCol - minCol + 1;
          const gaps = span - areaCols.length;
          if (gaps > 0) {
            total += gaps * 0.5;
          }
        }
      });
    });

    return total;
  };

  if (edges.length > 0) {
    // Helper function to run optimization from a given starting configuration
    const runOptimization = (
      startColumns: Record<string, number>,
    ): { columns: Record<string, number>; score: number } => {
      const testColumns = { ...startColumns };

      const levelOccupancy = new Map<number, Set<number>>();
      nodeLevelIndex.forEach((levelIndex, nodeId) => {
        const column = testColumns[nodeId];
        if (column === undefined) return;
        if (!levelOccupancy.has(levelIndex)) {
          levelOccupancy.set(levelIndex, new Set());
        }
        levelOccupancy.get(levelIndex)!.add(column);
      });

      let globalScore = evaluateCrossings(testColumns);
      const deltas = [0, -1, 1, -2, 2, -3, 3, -4, 4];

      for (let iteration = 0; iteration < 4; iteration += 1) {
        let improved = false;
        for (let levelIndex = 0; levelIndex < levelOrder.length; levelIndex += 1) {
          const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
          let occupancy = levelOccupancy.get(levelIndex);
          if (!occupancy) {
            occupancy = new Set<number>();
            levelOccupancy.set(levelIndex, occupancy);
          }
          nodesAtLevel.forEach((nodeId) => {
            const currentColumn = testColumns[nodeId];
            if (currentColumn === undefined) return;
            let bestColumn = currentColumn;
            let bestScore = globalScore;
            occupancy.delete(currentColumn);

            deltas.forEach((delta) => {
              const candidate = currentColumn + delta;
              if (candidate < 0) return;
              if (occupancy.has(candidate)) return;
              testColumns[nodeId] = candidate;
              occupancy.add(candidate);
              const candidateScore = evaluateCrossings(testColumns);
              occupancy.delete(candidate);
              testColumns[nodeId] = currentColumn;
              if (candidateScore + 1e-6 < bestScore) {
                bestScore = candidateScore;
                bestColumn = candidate;
              }
            });

            occupancy.add(currentColumn);

            if (bestColumn !== currentColumn) {
              occupancy.delete(currentColumn);
              occupancy.add(bestColumn);
              testColumns[nodeId] = bestColumn;
              globalScore = bestScore;
              improved = true;
            } else {
              testColumns[nodeId] = currentColumn;
            }
          });
        }
        if (!improved) break;
      }

      // Additional optimization: try swapping adjacent nodes within the same level
      for (let swapIteration = 0; swapIteration < 3; swapIteration += 1) {
        let swapImproved = false;
        for (let levelIndex = 0; levelIndex < levelOrder.length; levelIndex += 1) {
          const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
          if (nodesAtLevel.length < 2) continue;

          const sortedNodes = [...nodesAtLevel].sort(
            (a, b) => (testColumns[a] ?? 0) - (testColumns[b] ?? 0),
          );

          for (let i = 0; i < sortedNodes.length - 1; i += 1) {
            const nodeA = sortedNodes[i];
            const nodeB = sortedNodes[i + 1];
            const colA = testColumns[nodeA];
            const colB = testColumns[nodeB];

            if (colA === undefined || colB === undefined) continue;

            testColumns[nodeA] = colB;
            testColumns[nodeB] = colA;

            const swappedScore = evaluateCrossings(testColumns);

            if (swappedScore + 1e-6 < globalScore) {
              globalScore = swappedScore;
              swapImproved = true;
              sortedNodes[i] = nodeB;
              sortedNodes[i + 1] = nodeA;
            } else {
              testColumns[nodeA] = colA;
              testColumns[nodeB] = colB;
            }
          }
        }
        if (!swapImproved) break;
      }

      return { columns: testColumns, score: globalScore };
    };

    // Multi-start optimization: try different starting configurations
    const startingConfigs: Record<string, number>[] = [{ ...nodeColumns }];

    // Find max column to determine shift range
    const allColumns = Object.values(nodeColumns).filter(
      (v): v is number => v !== undefined,
    );
    const maxCol = allColumns.length > 0 ? Math.max(...allColumns) : 0;

    // Generate alternative starting configurations by shifting entire levels horizontally
    for (let levelIndex = 0; levelIndex < levelOrder.length; levelIndex += 1) {
      const nodesAtLevel = nodesByLevelIndex.get(levelIndex) ?? [];
      if (nodesAtLevel.length === 0) continue;

      // Try shifting all nodes at this level by various amounts
      for (let shift = -maxCol - 2; shift <= maxCol + 4; shift += 1) {
        if (shift === 0) continue;
        const config = { ...nodeColumns };
        let valid = true;

        nodesAtLevel.forEach((nodeId) => {
          const newCol = (config[nodeId] ?? 0) + shift;
          if (newCol < 0) valid = false;
          else config[nodeId] = newCol;
        });

        if (valid) startingConfigs.push(config);
      }
    }

    // Run optimization from each starting configuration and keep the best
    let bestResult = runOptimization(startingConfigs[0]);

    for (let i = 1; i < startingConfigs.length; i += 1) {
      const result = runOptimization(startingConfigs[i]);
      if (result.score < bestResult.score) {
        bestResult = result;
      }
    }

    // Apply the best result
    Object.assign(nodeColumns, bestResult.columns);

    nodesByLevelIndex.forEach((nodeIds) => {
      nodeIds.forEach((nodeId) => {
        const column = nodeColumns[nodeId];
        if (column !== undefined) {
          positions.set(nodeId, column);
        }
      });
    });
  }

  positions.forEach((_, key) => {
    const column = nodeColumns[key];
    if (column !== undefined) {
      positions.set(key, column);
    }
  });

  // Areas of one layer are siblings in a single CSS grid, each spanning
  // `[min column .. max column]` of the object types it holds. Nothing above
  // keeps a layer's areas apart — the crossing search orders individual nodes —
  // so two areas can interleave, their spans overlap, and grid auto-placement
  // drops the second one onto an implicit second row. It then reads as an
  // object type that belongs to no layer at all: on container-logistics,
  // `Truck` lands between `CustomerOrder` and `TransportDocument` and its area
  // is pushed into the gap below level 2.
  //
  // Re-seat each layer's types so every area occupies a contiguous block. The
  // columns already in use at the layer are kept and only redistributed, so the
  // layer's horizontal footprint — and its alignment against the layers above
  // and below — does not move, and neither does the crossing search's ordering
  // of the areas themselves.
  levelNodeMap.forEach((descriptors) => {
    if (descriptors.length === 0) return;

    const byArea = new Map<string, LevelNodeDescriptor[]>();
    descriptors.forEach((descriptor) => {
      const group = byArea.get(descriptor.areaId);
      if (group) group.push(descriptor);
      else byArea.set(descriptor.areaId, [descriptor]);
    });
    if (byArea.size < 2) return;

    const columnOf = (descriptor: LevelNodeDescriptor) =>
      nodeColumns[descriptor.id] ?? 0;
    const slots = descriptors.map(columnOf).sort((a, b) => a - b);
    // Areas keep the left-to-right order their nodes' mean column earned.
    const areas = Array.from(byArea.values()).sort((a, b) => {
      const meanA = a.reduce((sum, d) => sum + columnOf(d), 0) / a.length;
      const meanB = b.reduce((sum, d) => sum + columnOf(d), 0) / b.length;
      if (meanA === meanB) return a[0].orderHint - b[0].orderHint;
      return meanA - meanB;
    });

    const reseated = new Map<string, number>();
    let slot = 0;
    areas.forEach((group) => {
      group
        .slice()
        .sort((a, b) => {
          const diff = columnOf(a) - columnOf(b);
          return diff !== 0 ? diff : a.orderHint - b.orderHint;
        })
        .forEach((descriptor) => {
          reseated.set(descriptor.id, slots[slot]);
          slot += 1;
        });
    });

    reseated.forEach((column, nodeId) => {
      nodeColumns[nodeId] = column;
      positions.set(nodeId, column);
    });
  });

  const areaPlacements: Record<string, { startColumn: number; span: number }> = {};
  const levelAreaCursor = new Map<number, number>();

  layers.forEach((layer) => {
    let cursor = levelAreaCursor.get(layer.level) ?? 0;
    layer.areas.forEach((area) => {
      if (area.objectTypes.length === 0) {
        areaPlacements[area.id] = { startColumn: cursor, span: 1 };
        cursor += 1;
      } else {
        const columns = area.objectTypes
          .map((objectType) => nodeColumns[objectType])
          .filter((value): value is number => value !== undefined);
        if (columns.length === 0) {
          areaPlacements[area.id] = { startColumn: cursor, span: 1 };
          cursor += 1;
        } else {
          const minCol = Math.min(...columns);
          const maxCol = Math.max(...columns);
          areaPlacements[area.id] = { startColumn: minCol, span: Math.max(1, maxCol - minCol + 1) };
          cursor = Math.max(cursor, maxCol + 1);
        }
      }
    });
    levelAreaCursor.set(layer.level, cursor);
  });

  const totalColumns =
    Object.keys(nodeColumns).length > 0
      ? Math.max(
          ...Object.values(nodeColumns).concat(
            Object.values(areaPlacements).map((placement) => placement.startColumn + placement.span - 1),
          ),
        ) + 1
      : Math.max(
          0,
          ...Object.values(areaPlacements).map((placement) => placement.startColumn + placement.span),
        );

  return {
    nodeColumns,
    areaPlacements,
    totalColumns,
  };
}
