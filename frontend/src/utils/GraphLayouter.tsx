import type { Edge, Node } from '@xyflow/react';
import {
  type DfgLink,
  type DfgNode,
} from './NaiveOCDFGLayouting';
import { type Point, sampleCubicBezier } from './edgeGeometry';
import {
  BUFFER_ZONE_MARGIN,
  BUFFER_REPULSION_RADIUS,
  LONGEST_TRACE_BEZIER_SAMPLES,
  LONGEST_TRACE_BEZIER_HANDLE_SCALE,
  LONGEST_TRACE_LANE_OFFSET,
  CYCLE_BEND_MAGNITUDE,
  type EdgeCurveState,
  relaxPolylineAroundBuffers,
  buildBufferRectsFromNodes,
} from './edgeCurveGeneration';
import type { TraceVariantsPerType } from '../react_component/OCDFGVisualizer';

export type { DfgNode, DfgLink } from './NaiveOCDFGLayouting';


export interface LayoutRequest {
  renderNodes: Node[];
  renderEdges: Edge[];
  dfgNodes: DfgNode[];
  dfgLinks: DfgLink[];
  activeTypes?: string[];
  typeTraceLimit?: Record<string, number>;
  includeDebugOverlays?: boolean;
  backendTraceVariants?: TraceVariantsPerType;
}

export interface DebugLayerInfo {
  layerIndex: number;
  axisPosition: number;
  nodeIds: string[];
  dummyNodeIds: string[];
  bundleGroups: Array<{
    segmentKey: string;
    dummyIds: string[];
    bundleSize: number;
  }>;
}

export interface DebugNodeInfo {
  id: string;
  isDummy: boolean;
  layer: number;
  pos: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isInBundle?: boolean;
  bundleIndex?: number;
  segmentKey?: string;
  belongsToEdge?: string;
}

export interface DebugData {
  layers?: DebugLayerInfo[];
  nodes?: DebugNodeInfo[];
  direction?: 'TB' | 'LR';
  layerSep?: number;
  vertexSep?: number;
}

export type LayoutResult = Promise<{
  nodes: Node[];
  edges: Edge[];
  debug?: DebugData;
  traceCounts?: Record<string, number>;
}>;


const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;
const LAYER_MARKER_THICKNESS = 10;
const LAYER_MARKER_PADDING = 60;
const LAYER_MARKER_COLOR = 'rgba(255, 232, 138, 0.45)';
// Buffer constants now imported from edgeCurveGeneration.ts for algorithmic parity
const BUFFER_ZONE_COLOR = LAYER_MARKER_COLOR;

// Remember the last computed object-type column order per layout key so that
// subsequent layouts (e.g. when toggling object types) can preserve ordering
// without bleeding between independent instances.
const previousTypeOrderByKey = new Map<string, string[]>();

function buildLayerMarkers(
  axisPositions: number[],
  baseNodes: Node[],
  direction: 'TB' | 'LR',
) {
  if (!axisPositions || axisPositions.length === 0) {
    return [] as Node[];
  }

  const visibleNodes = baseNodes.filter(
    n => !n.hidden && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
  );
  if (visibleNodes.length === 0) {
    return [] as Node[];
  }

  const crossExtents = visibleNodes.map(node => {
    const width = node.width ?? DEFAULT_NODE_WIDTH;
    const height = node.height ?? DEFAULT_NODE_HEIGHT;
    if (direction === 'TB') {
      return {
        min: node.position!.x,
        max: node.position!.x + width,
      };
    }
    return {
      min: node.position!.y,
      max: node.position!.y + height,
    };
  });

  const crossMin = Math.min(...crossExtents.map(e => e.min));
  const crossMax = Math.max(...crossExtents.map(e => e.max));
  const crossSpan = crossMax - crossMin;
  const padding = Math.max(LAYER_MARKER_PADDING, crossSpan * 0.05);
  const thickness = LAYER_MARKER_THICKNESS;

  return axisPositions.map((axis, index) => {
    const width = direction === 'TB'
      ? crossSpan + padding * 2
      : thickness;
    const height = direction === 'TB'
      ? thickness
      : crossSpan + padding * 2;

    const position = direction === 'TB'
      ? { x: crossMin - padding, y: axis - height / 2 }
      : { x: axis - width / 2, y: crossMin - padding };

    return {
      id: `debug-layer-${index}`,
      type: 'debugLayer',
      position,
      data: {
        color: LAYER_MARKER_COLOR,
        label: `${index + 1}`,
        direction,
      },
      width,
      height,
      draggable: false,
      selectable: false,
      style: {
        width,
        height,
        padding: 0,
        border: 'none',
        pointerEvents: 'none',
        zIndex: -10,
      },
    } satisfies Node;
  });
}

function buildBufferZones(baseNodes: Node[], margin: number) {
  const visibleNodes = baseNodes.filter(
    n => !n.hidden && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
  );
  if (visibleNodes.length === 0) {
    return [] as Node[];
  }

  return visibleNodes.map((node, index) => {
    const width = (node.width ?? DEFAULT_NODE_WIDTH) + margin * 2;
    const height = (node.height ?? DEFAULT_NODE_HEIGHT) + margin * 2;
    const position = {
      x: (node.position!.x ?? 0) - margin,
      y: (node.position!.y ?? 0) - margin,
    };

    return {
      id: `debug-buffer-${node.id}-${index}`,
      type: 'debugLayer',
      position,
      data: {
        color: BUFFER_ZONE_COLOR,
        label: '',
        direction: 'TB' as const,
      },
      width,
      height,
      draggable: false,
      selectable: false,
      style: {
        width,
        height,
        padding: 0,
        border: 'none',
        pointerEvents: 'none',
        zIndex: -9,
      },
    } satisfies Node;
  });
}

type BufferRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function buildBufferRects(baseNodes: Node[], margin: number): BufferRect[] {
  return baseNodes
    .filter(
      n => !n.hidden && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
    )
    .map((node) => {
      const width = (node.width ?? DEFAULT_NODE_WIDTH) + margin * 2;
      const height = (node.height ?? DEFAULT_NODE_HEIGHT) + margin * 2;
      const left = (node.position!.x ?? 0) - margin;
      const top = (node.position!.y ?? 0) - margin;
      return {
        id: node.id,
        left,
        right: left + width,
        top,
        bottom: top + height,
      };
    });
}

export async function layoutOCDFGLongestTrace({
  renderNodes,
  renderEdges,
  dfgNodes,
  dfgLinks,
  typeTraceLimit,
  activeTypes,
  direction = 'TB',
  layoutKey,
  includeDebugOverlays = true,
  ignoreTypesWithoutTraces = false,
  backendTraceVariants,
}: LayoutRequest & {
  direction?: 'TB' | 'LR';
  layoutKey?: string;
  ignoreTypesWithoutTraces?: boolean;
}): LayoutResult {
  console.log(`[LAYOUT LONGEST TRACE] layoutOCDFGLongestTrace called with ${renderNodes.length} nodes, ${renderEdges.length} edges, direction: ${direction}`);

  return layoutWithLongestTrace(
    renderNodes,
    renderEdges,
    dfgNodes,
    dfgLinks,
    typeTraceLimit,
    activeTypes,
    direction,
    layoutKey,
    includeDebugOverlays,
    ignoreTypesWithoutTraces,
    backendTraceVariants,
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getLayoutSpacing(direction: 'TB' | 'LR' = 'TB', preset?: string) {
  // Spacing along trace flow (vertical in internal layout)
  // This becomes HORIZONTAL in LR after swap
  const nodePrimarySpacing = 150;  // Keep same for both modes

  // Spacing between object type columns (horizontal in internal layout)
  // This becomes VERTICAL in LR after swap - needs to be SMALLER!
  const columnPadding = direction === 'LR' ? 30 : 60;
  const nodeSize = direction === 'LR' ? 72 : 180;  // Use height for LR, width for TB
  const columnSpacing = nodeSize * 1.8 + columnPadding;  // Reduced multiplier for LR

  return { nodePrimarySpacing, columnPadding, columnSpacing };
}

type OwnerEntry = {
  owners?: string[];
  ownerTypes?: string[];
};

const resolveOwnerTypes = (entry: OwnerEntry) => {
  const values = entry.ownerTypes && entry.ownerTypes.length > 0
    ? entry.ownerTypes
    : entry.owners ?? [];
  return values.filter((t): t is string => typeof t === 'string' && t.length > 0);
};

const resolveOwnerPairs = (entry: OwnerEntry) => {
  const owners = entry.owners ?? [];
  const ownerTypes = entry.ownerTypes ?? [];
  if (owners.length > 0 && ownerTypes.length === owners.length) {
    return owners
      .map((owner, index) => ({ owner, type: ownerTypes[index] }))
      .filter(
        (pair): pair is { owner: string; type: string } =>
          typeof pair.owner === 'string'
          && pair.owner.length > 0
          && typeof pair.type === 'string'
          && pair.type.length > 0,
      );
  }
  return resolveOwnerTypes(entry).map(type => ({ owner: type, type }));
};

async function layoutWithLongestTrace(
  renderNodes: Node[],
  renderEdges: Edge[],
  dfgNodes: DfgNode[],
  dfgLinks: DfgLink[],
  typeTraceLimit?: Record<string, number>,
  activeTypes?: string[],
  direction: 'TB' | 'LR' = 'TB',
  layoutKey?: string,
  includeDebugOverlays = true,
  ignoreTypesWithoutTraces = false,
  backendTraceVariants?: TraceVariantsPerType,
): LayoutResult {
  console.log('[LONGEST TRACE] Starting longest trace layout');

  const activeTypeSet = activeTypes
    ? new Set(
        activeTypes.filter((t): t is string => typeof t === 'string' && t.trim().length > 0),
      )
    : null;

  if (activeTypeSet && activeTypeSet.size === 0) {
    console.warn('[LONGEST TRACE] No active object types specified, returning empty layout.');
    return { nodes: [], edges: [] };
  }

  // Type for trace information
  type TraceInfo = {
    trace: string[];
    owner: string;
    length: number;
  };

  const traceLimitMap = new Map<string, number>();
  if (typeTraceLimit) {
    Object.entries(typeTraceLimit).forEach(([type, limit]) => {
      if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
        traceLimitMap.set(type, limit);
      }
    });
  }

  
  const validNodeIds = new Set(dfgNodes.map(n => n.id));

  const tracesByType = new Map<string, TraceInfo[]>();
  const traceCounts: Record<string, number> = {};

  if (backendTraceVariants && Object.keys(backendTraceVariants).length > 0) {
    console.log('[LONGEST TRACE] Using backend trace variants (actual OCEL traces)');

    Object.entries(backendTraceVariants).forEach(([objectType, typeData]) => {
      if (activeTypeSet && !activeTypeSet.has(objectType)) return;
      if (!typeData.variants || typeData.variants.length === 0) return;

      const traces: TraceInfo[] = [];

      typeData.variants.forEach((variant, variantIndex) => {
        if (!variant.trace || variant.trace.length === 0) return;

        // Debug: Log the raw backend trace
        console.log(`[TRACE DEBUG] Backend trace for ${objectType} variant ${variantIndex}:`, variant.trace);
        console.log(`[TRACE DEBUG] Trace has ${variant.trace.length} elements, unique: ${new Set(variant.trace).size}`);

        // Build the full trace including start/end nodes
        // Backend traces contain activity names; we add start/end markers
        const startNodeId = `__start__:${objectType}`;
        const endNodeId = `__end__:${objectType}`;

        // Build trace: start -> activities -> end
        const fullTrace: string[] = [];

        // Add start node if it exists in the graph
        if (validNodeIds.has(startNodeId)) {
          fullTrace.push(startNodeId);
        }

        // Add activity nodes (only those that exist in the graph)
        variant.trace.forEach(activity => {
          if (validNodeIds.has(activity)) {
            fullTrace.push(activity);
          }
        });

        // Add end node if it exists in the graph
        if (validNodeIds.has(endNodeId)) {
          fullTrace.push(endNodeId);
        }

        if (fullTrace.length === 0) return;

        // Debug: Log the full trace with start/end nodes
        console.log(`[TRACE DEBUG] Full trace for ${objectType} variant ${variantIndex}:`, fullTrace);
        const hasSelfLoop = fullTrace.some((node, i) => i > 0 && fullTrace[i - 1] === node);
        console.log(`[TRACE DEBUG] Contains self-loop: ${hasSelfLoop}`);

        // Create one TraceInfo entry per variant
        // Use a synthetic owner ID based on object type and variant index
        traces.push({
          trace: fullTrace,
          owner: `${objectType}_variant_${variantIndex}`,
          length: fullTrace.length,
        });
      });

      if (traces.length > 0) {
        // Sort by length (descending) - longest traces first
        traces.sort((a, b) => b.length - a.length);
        tracesByType.set(objectType, traces);
        traceCounts[objectType] = traces.length;
      }
    });

    console.log(`[LONGEST TRACE] Loaded ${Array.from(tracesByType.values()).flat().length} traces from backend for ${tracesByType.size} object types`);
  } else {
    // Fallback: compute traces via DFS on graph structure (legacy behavior)
    console.log('[LONGEST TRACE] No backend trace variants, falling back to DFS computation');

    // Build a map of edges by their owners (object instances)
    const ownerEdges = new Map<string, Array<{ source: string; target: string; link: DfgLink }>>();
    const ownerTypeByOwner = new Map<string, string>();

    dfgLinks.forEach(link => {
      const ownerPairs = resolveOwnerPairs(link);
      ownerPairs.forEach(({ owner, type }) => {
        if (activeTypeSet && !activeTypeSet.has(type)) {
          return;
        }
        if (!ownerTypeByOwner.has(owner)) {
          ownerTypeByOwner.set(owner, type);
        }
        if (!ownerEdges.has(owner)) {
          ownerEdges.set(owner, []);
        }
        ownerEdges.get(owner)!.push({ source: link.source, target: link.target, link });
      });
    });

    console.log(`[LONGEST TRACE] Found ${ownerEdges.size} unique object instances`);

    const allTraces: TraceInfo[] = [];

    ownerEdges.forEach((edges, owner) => {
      const adjacency = new Map<string, string[]>();
      const incomingCount = new Map<string, number>();
      const allNodes = new Set<string>();

      edges.forEach(({ source, target }) => {
        if (!adjacency.has(source)) {
          adjacency.set(source, []);
        }
        adjacency.get(source)!.push(target);

        incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
        if (!incomingCount.has(source)) {
          incomingCount.set(source, 0);
        }
        allNodes.add(source);
        allNodes.add(target);
      });

      const startNodes = Array.from(allNodes).filter(node => (incomingCount.get(node) || 0) === 0);
      const seeds = startNodes.length > 0 ? startNodes : Array.from(allNodes);

      const pathLimit = 500;
      const uniquePaths = new Set<string>();

      const dfs = (current: string, path: string[], visited: Set<string>) => {
        if (path.length > pathLimit) {
          console.warn(`[LONGEST TRACE] Path limit reached for owner ${owner}, stopping expansion.`);
          uniquePaths.add(path.join('->'));
          return;
        }
        const nextList = adjacency.get(current) ?? [];
        const available = nextList.filter(n => !visited.has(n));
        if (available.length === 0) {
          uniquePaths.add(path.join('->'));
          return;
        }
        available.forEach((next) => {
          visited.add(next);
          path.push(next);
          dfs(next, path, visited);
          path.pop();
          visited.delete(next);
        });
      };

      seeds.forEach((start) => {
        const visited = new Set<string>([start]);
        dfs(start, [start], visited);
      });

      uniquePaths.forEach((pathKey) => {
        const trace = pathKey.split('->').filter(Boolean);
        if (trace.length === 0) return;
        allTraces.push({
          trace,
          owner,
          length: trace.length,
        });
      });
    });

    // Sort traces by length (descending)
    allTraces.sort((a, b) => b.length - a.length);

    allTraces.forEach((t) => {
      if (t.trace.length === 0) return;
      const ownerType = ownerTypeByOwner.get(t.owner) ?? t.owner;
      if (activeTypeSet && !activeTypeSet.has(ownerType)) return;
      if (!tracesByType.has(ownerType)) {
        tracesByType.set(ownerType, []);
      }
      tracesByType.get(ownerType)!.push({ ...t });
    });

    tracesByType.forEach((traces, type) => {
      traceCounts[type] = traces.length;
    });
  }

  const selectedTraces: Array<TraceInfo & { ownerType: string; index: number }> = [];
  Array.from(tracesByType.entries()).forEach(([type, traces]) => {
    const limit = traceLimitMap.has(type) ? Math.max(0, traceLimitMap.get(type) ?? 0) : traces.length;
    const sorted = traces.slice().sort((a, b) => b.length - a.length);
    const slice = sorted.slice(0, limit);
    slice.forEach((t, idx) => {
      selectedTraces.push({ ...t, ownerType: type, index: idx });
    });
  });

  selectedTraces.sort((a, b) => {
    const lenDiff = b.length - a.length;
    if (lenDiff !== 0) return lenDiff;
    return a.owner.localeCompare(b.owner);
  });

  const logCount = Math.min(selectedTraces.length, 5);
  for (let i = 0; i < logCount; i += 1) {
    const t = selectedTraces[i];
    console.log(`[LONGEST TRACE] Trace #${i + 1} has ${t.trace.length} nodes for owner "${t.owner}":`, t.trace);
    console.log(`[LONGEST TRACE] Object type of trace #${i + 1}: "${t.ownerType}"`);
  }

  // If no trace was found, return empty layout
  if (selectedTraces.length === 0) {
    console.warn('[LONGEST TRACE] No valid trace found');
    return { nodes: [], edges: [] };
  }

  const renderNodeById = new Map(renderNodes.map(n => [n.id, n]));
  const visibleNodeIds = new Set<string>(
    selectedTraces.flatMap(t => t.trace),
  );
  const tracedTypes = new Set<string>(selectedTraces.map((t) => t.ownerType));

  const getNodeTypes = (nodeId: string): string[] => {
    const node = renderNodeById.get(nodeId);
    const data = node?.data as { types?: string[] } | undefined;
    const types = (data?.types ?? [])
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    const filteredByTraces =
      ignoreTypesWithoutTraces && tracedTypes.size > 0
        ? types.filter((type) => tracedTypes.has(type))
        : types;
    return activeTypeSet ? filteredByTraces.filter(type => activeTypeSet.has(type)) : filteredByTraces;
  };

  const includedTypes = new Set<string>();
  visibleNodeIds.forEach((id) => {
    getNodeTypes(id).forEach(t => includedTypes.add(t));
  });
  if (includedTypes.size === 0) {
    selectedTraces.forEach(({ ownerType }) => {
      if (!ownerType) return;
      if (activeTypeSet && !activeTypeSet.has(ownerType)) return;
      includedTypes.add(ownerType);
    });
  }
  if (ignoreTypesWithoutTraces && includedTypes.size === 0) {
    // No traced types left; nothing to lay out.
    return { nodes: [], edges: [], traceCounts };
  }

  type WeightMap = Map<string, Map<string, number>>;
  const ensureWeight = (weights: WeightMap, a: string, b: string) => {
    if (!weights.has(a)) weights.set(a, new Map());
    const inner = weights.get(a)!;
    if (!inner.has(b)) inner.set(b, 0);
    return inner;
  };

  const weights: WeightMap = new Map();

  const addWeight = (a: string, b: string, value: number) => {
    if (a === b) return;
    if (!includedTypes.has(a) || !includedTypes.has(b)) return;
    const innerAB = ensureWeight(weights, a, b);
    const innerBA = ensureWeight(weights, b, a);
    innerAB.set(b, (innerAB.get(b) ?? 0) + value);
    innerBA.set(a, (innerBA.get(a) ?? 0) + value);
  };

  // Shared node contribution
  visibleNodeIds.forEach((id) => {
    const types = getNodeTypes(id);
    if (types.length < 2) return;
    const increment = 1 / (types.length - 1);
    for (let i = 0; i < types.length; i += 1) {
      for (let j = i + 1; j < types.length; j += 1) {
        addWeight(types[i], types[j], increment);
      }
    }
  });

  // Cross-type edge contribution (only edges between visible nodes)
  const visibleIds = new Set(visibleNodeIds);
  renderEdges.forEach((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) {
      return;
    }
    const sourceTypes = getNodeTypes(edge.source);
    const targetTypes = getNodeTypes(edge.target);
    sourceTypes.forEach((a) => {
      targetTypes.forEach((b) => {
        if (a !== b) {
          addWeight(a, b, 1);
        }
      });
    });
  });

  const typeList = Array.from(includedTypes);

  // Estimate a "temporal center" for each type based on where its
  // nodes appear along the selected traces (0 = early, 1 = late).
  const typeTimeAgg = new Map<string, { sum: number; count: number }>();
  selectedTraces.forEach(({ trace }) => {
    if (!trace || trace.length === 0) return;
    const length = trace.length;
    trace.forEach((nodeId, index) => {
      const nodeTypes = getNodeTypes(nodeId);
      if (nodeTypes.length === 0) return;
      const position = length > 1 ? index / (length - 1) : 0.5;
      nodeTypes.forEach((type) => {
        if (!includedTypes.has(type)) return;
        const agg = typeTimeAgg.get(type) ?? { sum: 0, count: 0 };
        agg.sum += position;
        agg.count += 1;
        typeTimeAgg.set(type, agg);
      });
    });
  });

  const getTypeTimeCenter = (type: string): number => {
    const agg = typeTimeAgg.get(type);
    if (!agg || agg.count === 0) return 0.5;
    return agg.sum / agg.count;
  };

  const typeOrderByTime = [...typeList].sort(
    (a, b) => getTypeTimeCenter(a) - getTypeTimeCenter(b),
  );
  const idealTimeIndex = new Map<string, number>();
  typeOrderByTime.forEach((type, index) => {
    idealTimeIndex.set(type, index);
  });

  const timePenalty = (order: string[]): number => {
    let penalty = 0;
    order.forEach((type, index) => {
      const ideal = idealTimeIndex.get(type);
      if (ideal === undefined) return;
      penalty += Math.abs(index - ideal);
    });
    return penalty;
  };

  const layoutCost = (order: string[]): number => {
    let cost = 0;
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const a = order[i];
        const b = order[j];
        const w = weights.get(a)?.get(b) ?? 0;
        cost += w * Math.abs(j - i);
      }
    }
    return cost;
  };

  const cacheKey = layoutKey && layoutKey.length > 0 ? layoutKey : 'global';
  const previousTypeOrder = previousTypeOrderByKey.get(cacheKey) ?? null;

  const computeOrder = (): string[] => {
    if (typeList.length <= 1) return [...typeList];

    const hasPreviousOrder = Array.isArray(previousTypeOrder)
      && previousTypeOrder.length > 0;

    const baselineOrder: string[] | null = hasPreviousOrder
      ? (() => {
          const prev = previousTypeOrder as string[];
          const result: string[] = [];
          const seen = new Set<string>();
          prev.forEach((type) => {
            if (!includedTypes.has(type)) return;
            if (!typeList.includes(type)) return;
            result.push(type);
            seen.add(type);
          });
          typeList.forEach((type) => {
            if (!seen.has(type)) {
              result.push(type);
            }
          });
          return result.length === typeList.length ? result : null;
        })()
      : null;

    let bestOrder: string[] = [...typeList];

    // For a small number of types, exhaustively search all permutations.
    // Use interaction cost as the primary metric and temporal penalty
    // only as a tiebreaker when no previous layout exists.
    if (typeList.length <= 8) {
      let bestCost = Number.POSITIVE_INFINITY;
      let bestTimePenalty = Number.POSITIVE_INFINITY;

      const used = new Set<string>();
      const current: string[] = [];

      const dfs = () => {
        if (current.length === typeList.length) {
          const cost = layoutCost(current);
          const tPenalty = timePenalty(current);

          if (cost < bestCost - 1e-6
            || (Math.abs(cost - bestCost) <= 1e-6 && tPenalty + 1e-6 < bestTimePenalty)
          ) {
            bestCost = cost;
            bestTimePenalty = tPenalty;
            bestOrder = [...current];
          }
          return;
        }
        typeList.forEach((type) => {
          if (used.has(type)) return;
          used.add(type);
          current.push(type);
          dfs();
          current.pop();
          used.delete(type);
        });
      };

      dfs();
    } else {
      const totalWeights = typeList.map((t) => {
        const sum = weights.get(t)
          ? Array.from(weights.get(t)!.values()).reduce((acc, v) => acc + v, 0)
          : 0;
        return { type: t, sum };
      });

      const allZero = totalWeights.every(({ sum }) => sum <= 0);
      if (allZero) {
        bestOrder = [...typeList].sort();
      } else {
        totalWeights.sort((a, b) => b.sum - a.sum);
        const order: string[] = [totalWeights[0].type];
        const remaining = new Set(typeList.filter(t => t !== totalWeights[0].type));

        const insertionCost = (current: string[], candidate: string, index: number) => {
          const newOrder = [...current.slice(0, index), candidate, ...current.slice(index)];
          return layoutCost(newOrder);
        };

        while (remaining.size > 0) {
          let bestType: string | null = null;
          let bestIndex = 0;
          let bestCost = Number.POSITIVE_INFINITY;
          Array.from(remaining).forEach((candidate) => {
            for (let i = 0; i <= order.length; i += 1) {
              const cost = insertionCost(order, candidate, i);
              if (cost < bestCost - 1e-6) {
                bestCost = cost;
                bestType = candidate;
                bestIndex = i;
              }
            }
          });
          if (bestType === null) {
            break;
          }
          order.splice(bestIndex, 0, bestType);
          remaining.delete(bestType);
        }

        // Local improvement: adjacent swaps
        let improved = true;
        while (improved) {
          improved = false;
          for (let i = 0; i < order.length - 1; i += 1) {
            const swapped = [...order];
            [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
            const currentCost = layoutCost(order);
            const swappedCost = layoutCost(swapped);
            if (swappedCost + 1e-6 < currentCost) {
              order.splice(0, order.length, ...swapped);
              improved = true;
            }
          }
        }

        bestOrder = order;
      }
    }

    // If we have a previous layout, only move away from the previous
    // ordering when the interaction cost strictly improves. Symmetric
    // reorderings (like mirroring) that keep the same cost are rejected,
    // so columns stay where users expect them.
    if (baselineOrder) {
      const EPS = 1e-6;
      const baselineCost = layoutCost(baselineOrder);
      const bestCost = layoutCost(bestOrder);
      if (bestCost >= baselineCost - EPS) {
        return baselineOrder;
      }
    }

    return bestOrder;
  };

  const typeOrder = computeOrder();
  previousTypeOrderByKey.set(cacheKey, [...typeOrder]);

  // Find shared nodes between traces
  const traceMembership = new Map<string, number[]>();
  selectedTraces.forEach((t, traceIdx) => {
    t.trace.forEach((nodeId) => {
      const list = traceMembership.get(nodeId) ?? [];
      list.push(traceIdx);
      traceMembership.set(nodeId, list);
    });
  });

  const sharedNodes = new Set<string>(
    Array.from(traceMembership.entries())
      .filter(([, traces]) => traces.length > 1)
      .map(([nodeId]) => nodeId),
  );
  console.log(`[LONGEST TRACE] Shared nodes between traces:`, Array.from(sharedNodes));

  // Layout configuration - direction-aware spacing
  const spacing = getLayoutSpacing(direction);
  const VERTICAL_SPACING = spacing.nodePrimarySpacing;
  const COLUMN_PADDING = spacing.columnPadding;
  const COLUMN_SPACING = spacing.columnSpacing; // center-to-center spacing with a full column gap
  const FIRST_COLUMN_CENTER = 300; 
  const typeCenters = new Map<string, number>();
  const typeIndex = new Map<string, number>();
  typeOrder.forEach((type, index) => {
    typeCenters.set(type, FIRST_COLUMN_CENTER + index * COLUMN_SPACING);
    typeIndex.set(type, index);
  });

  const fallbackCenter = typeOrder.length > 0
    ? (typeCenters.get(typeOrder[0]) ?? FIRST_COLUMN_CENTER)
    : FIRST_COLUMN_CENTER;

  const resolveCenterForTypes = (types: string[]) => {
    const indices = types
      .map(t => typeIndex.get(t))
      .filter((v): v is number => typeof v === 'number');
    if (indices.length === 0) return fallbackCenter;
    const minIdx = Math.min(...indices);
    const maxIdx = Math.max(...indices);
    const minCenter = typeCenters.get(typeOrder[minIdx]) ?? fallbackCenter;
    const maxCenter = typeCenters.get(typeOrder[maxIdx]) ?? fallbackCenter;
    return (minCenter + maxCenter) / 2;
  };
  const START_Y = 100;

  // Identify terminal nodes (start/end nodes) by checking if they have specific variants
  const isTerminalNode = (nodeId: string): boolean => {
    const node = renderNodes.find(n => n.id === nodeId);
    const variant = (node?.data as { variant?: string })?.variant;
    return variant === 'start' || variant === 'end';
  };

  // Filter out terminal nodes from traces to get only activity nodes
  const traceActivities = selectedTraces.map(({ trace }) =>
    trace.filter(nodeId => !isTerminalNode(nodeId)),
  );

  console.log(
    '[LONGEST TRACE] Activity counts per trace:',
    traceActivities.map((acts, idx) => `#${idx + 1}:${acts.length}`).join(', '),
  );

  const activityPositions = new Map<string, number>();
  traceActivities.forEach((activities) => {
    activities.forEach((nodeId, index) => {
      if (!activityPositions.has(nodeId)) {
        const y = START_Y + index * VERTICAL_SPACING;
        activityPositions.set(nodeId, y);
      }
    });
  });

  const lastActivityYByTrace = traceActivities.map((activities) => {
    const last = activities[activities.length - 1];
    return last ? (activityPositions.get(last) || START_Y) : START_Y;
  });
  const endNodeY = Math.max(...lastActivityYByTrace, START_Y) + VERTICAL_SPACING;

  // Position nodes based on which trace(s) they belong to
  const positionedNodes = renderNodes.map((node) => {
    const measured = (node as { measured?: { width?: number; height?: number } }).measured;
    const renderWidth = measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH;
    const renderHeight = measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
    const nextStyle = node.style ? { ...node.style } : {};
    if (Number.isFinite(renderWidth)) {
      const existingMinWidth = typeof node.style?.minWidth === 'number'
        ? node.style?.minWidth
        : (typeof node.style?.minWidth === 'string' ? parseFloat(node.style.minWidth) : undefined);
      nextStyle.width = renderWidth;
      nextStyle.minWidth = Number.isFinite(existingMinWidth)
        ? Math.max(existingMinWidth ?? 0, renderWidth)
        : renderWidth;
    }
    const resolvedStyle = Object.keys(nextStyle).length > 0 ? nextStyle : node.style;

    const membership = traceMembership.get(node.id) ?? [];
    const isShared = membership.length > 1;
    const isTerminal = isTerminalNode(node.id);

    if (membership.length > 0) {
      let x: number;
      let y: number;

      const nodeTypes = getNodeTypes(node.id);
      const chosenCenter = resolveCenterForTypes(nodeTypes);

      const dataWithOrder = {
        ...(node.data || {}),
        typeOrder,
      };

      if (isTerminal) {
        // Terminal nodes (start/end) are positioned based on their type
        const variant = (node.data as { variant?: string })?.variant;

        if (variant === 'start') {
          // Start nodes go above the first activity (negative index)
          x = chosenCenter - renderWidth / 2;
          y = START_Y - VERTICAL_SPACING; // One row above first activity
        } else {
          // End nodes go below the last activity
          x = chosenCenter - renderWidth / 2;
          // Use the calculated end node Y position
          y = endNodeY;
        }
      } else if (isShared) {
        // Shared activity nodes go between participating columns
        x = chosenCenter - renderWidth / 2;
        // Use the pre-calculated Y position
        y = activityPositions.get(node.id) || START_Y;
      } else {
        // Single-trace activity nodes use the barycenter of their type lanes
        x = chosenCenter - renderWidth / 2;
        y = activityPositions.get(node.id) || START_Y;
      }

      return {
        ...node,
        position: { x, y },
        width: renderWidth,
        height: renderHeight,
        style: resolvedStyle,
        data: dataWithOrder,
      };
    } else {
      // Node is not in any considered trace - hide it
      return {
        ...node,
        position: {
          x: -10000,
          y: -10000,
        },
        hidden: true,
      };
    }
  });

  const traceSequences = selectedTraces.map(t => t.trace);
  const nodeMap = new Map(positionedNodes.map(n => [n.id, { ...n }]));

  const visibleLayerIds = new Set(
    positionedNodes
      .filter(n => !n.hidden && n.position && Number.isFinite(n.position.y))
      .map(n => n.id),
  );

  const variantOf = (nodeId: string) => {
    const node = renderNodes.find(n => n.id === nodeId);
    const data = node?.data as Record<string, unknown> | undefined;
    const variant =
      (data?.nodeVariant as string | undefined)
      ?? (data?.variant as string | undefined)
      ?? (data?.isStart ? 'start' : undefined);
    if (variant === 'start' || variant === 'end' || variant === 'center') {
      return variant;
    }
    return undefined;
  };

  const computeLayerMap = (nodesById: Map<string, Node>) => {
    const layerMap = new Map<string, number>();
    visibleLayerIds.forEach((id) => {
      const node = nodesById.get(id);
      if (!node || !node.position) return;
      const h = node.height ?? DEFAULT_NODE_HEIGHT;
      const centerY = node.position.y + h / 2;
      const rawLayer = (centerY - START_Y) / VERTICAL_SPACING;
      let approxLayer = Math.round(rawLayer);
      const variant = variantOf(id);
      if (variant === 'start') {
        approxLayer = Math.min(approxLayer, -1);
      } else {
        approxLayer = Math.max(0, approxLayer);
      }
      layerMap.set(id, approxLayer);
    });
    return layerMap;
  };

  const predecessors = new Map<string, Set<string>>();
  const addPred = (to: string, from: string) => {
    if (!visibleLayerIds.has(to) || !visibleLayerIds.has(from)) return;
    if (!predecessors.has(to)) predecessors.set(to, new Set());
    predecessors.get(to)!.add(from);
  };
  traceSequences.forEach((trace) => {
    for (let i = 0; i < trace.length - 1; i += 1) {
      addPred(trace[i + 1], trace[i]);
    }
  });

  const applyLayerConstraints = (nodesById: Map<string, Node>, layerMap: Map<string, number>) => {
    const baseLayers = new Map(layerMap);
    const layerMemo = new Map<string, number>();
    const resolving = new Set<string>();
    const resolveDeepestLayer = (id: string): number => {
      if (layerMemo.has(id)) return layerMemo.get(id)!;
      if (resolving.has(id)) {
        // Cycle guard: fall back to the current layer estimate
        return baseLayers.get(id) ?? 0;
      }
      resolving.add(id);
      let best = baseLayers.get(id) ?? 0;
      const preds = predecessors.get(id);
      if (preds && preds.size > 0) {
        preds.forEach((pred) => {
          const candidate = resolveDeepestLayer(pred) + 1;
          if (candidate > best) best = candidate;
        });
      }
      layerMemo.set(id, best);
      resolving.delete(id);
      return best;
    };

    const resolvedLayers = new Map<string, number>();
    visibleLayerIds.forEach((id) => {
      if (variantOf(id) === 'start') {
        return;
      }
      resolvedLayers.set(id, resolveDeepestLayer(id));
    });

    const activityLayers = Array.from(resolvedLayers.entries())
      .filter(([id]) => variantOf(id) !== 'end')
      .map(([, layer]) => layer);
    const maxActivityLayer = activityLayers.length > 0
      ? Math.max(...activityLayers)
      : 0;
    const maxEndLayer = maxActivityLayer + 1;

    visibleLayerIds.forEach((id) => {
      if (variantOf(id) === 'start') {
        return;
      }
      let newLayer = resolvedLayers.get(id) ?? baseLayers.get(id) ?? 0;
      if (variantOf(id) === 'end') {
        newLayer = Math.min(newLayer, maxEndLayer);
      }
      const node = nodesById.get(id);
      if (!node || !node.position) return;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;
      const newCenterY = START_Y + newLayer * VERTICAL_SPACING;
      layerMap.set(id, newLayer);
      nodesById.set(id, {
        ...node,
        position: {
          ...node.position,
          y: newCenterY - height / 2,
        },
      });
    });

    // Compact layer indices to remove gaps (especially trailing empty layers).
    const nonStartLayers = new Set<number>();
    visibleLayerIds.forEach((id) => {
      if (variantOf(id) === 'start') {
        return;
      }
      const layer = layerMap.get(id);
      if (typeof layer === 'number' && Number.isFinite(layer)) {
        nonStartLayers.add(layer);
      }
    });

    if (nonStartLayers.size === 0) {
      return;
    }

    const sortedLayers = Array.from(nonStartLayers).sort((a, b) => a - b);
    const remap = new Map<number, number>();
    let needsRemap = false;
    sortedLayers.forEach((layer, idx) => {
      remap.set(layer, idx);
      if (layer !== idx) {
        needsRemap = true;
      }
    });

    if (!needsRemap) {
      return;
    }

    visibleLayerIds.forEach((id) => {
      if (variantOf(id) === 'start') {
        return;
      }
      const oldLayer = layerMap.get(id);
      if (oldLayer === undefined) {
        return;
      }
      const newLayer = remap.get(oldLayer);
      if (newLayer === undefined || newLayer === oldLayer) {
        return;
      }
      const node = nodesById.get(id);
      if (!node || !node.position) {
        return;
      }
      const height = node.height ?? DEFAULT_NODE_HEIGHT;
      const newCenterY = START_Y + newLayer * VERTICAL_SPACING;
      layerMap.set(id, newLayer);
      nodesById.set(id, {
        ...node,
        position: {
          ...node.position,
          y: newCenterY - height / 2,
        },
      });
    });
  };

  let layerOf = computeLayerMap(nodeMap);
  // Enforce a downward flow for all trace edges.
  applyLayerConstraints(nodeMap, layerOf);

  // Slightly offset nodes within the same column when some traces skip over
  // intermediate nodes in that column. This keeps long vertical traces visible
  // while leaving straight, unskipped chains untouched.
  const getCenter = (id: string) => {
    const node = nodeMap.get(id);
    if (!node || !node.position) return null;
    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const h = node.height ?? DEFAULT_NODE_HEIGHT;
    return {
      x: node.position.x + w / 2,
      y: node.position.y + h / 2,
    };
  };

  const COLUMN_TOLERANCE = 8; // px tolerance to consider nodes in the same column
  const OFFSET_STEP = 64; // horizontal nudge in px

  const columnBuckets = new Map<number, string[]>();
  const blockerIds = new Set<string>();
  visibleLayerIds.forEach((id) => {
    const center = getCenter(id);
    if (!center) return;
    const key = Math.round(center.x / COLUMN_TOLERANCE) * COLUMN_TOLERANCE;
    const existing = columnBuckets.get(key) ?? [];
    existing.push(id);
    columnBuckets.set(key, existing);
  });

  const toOffset = new Set<string>();

  columnBuckets.forEach((ids) => {
    // Order nodes in this column by vertical position
    const sorted = ids
      .map(id => ({ id, center: getCenter(id) }))
      .filter((entry): entry is { id: string; center: { x: number; y: number } } => Boolean(entry?.center))
      .sort((a, b) => a.center.y - b.center.y);

    const indexById = new Map<string, number>();
    sorted.forEach((entry, idx) => indexById.set(entry.id, idx));

    // Detect skips: if a trace connects nodes that are not adjacent in this column,
    // mark the intermediate nodes for horizontal offset.
    traceSequences.forEach((trace) => {
      const indicesInCol = trace
        .map(id => indexById.get(id))
        .filter((v): v is number => typeof v === 'number');
      for (let i = 0; i < indicesInCol.length - 1; i += 1) {
        const a = indicesInCol[i];
        const b = indicesInCol[i + 1];
        if (Math.abs(a - b) <= 1) continue; // consecutive, keep straight
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let j = lo + 1; j < hi; j += 1) {
          const skippedId = sorted[j]?.id;
          if (skippedId) {
            toOffset.add(skippedId);
            blockerIds.add(skippedId);
          }
        }
      }
    });

    // Apply offsets to marked nodes, alternating left/right down the column.
    let direction = -1;
    sorted.forEach((entry) => {
      if (!toOffset.has(entry.id)) {
        return;
      }
      const node = nodeMap.get(entry.id);
      if (!node || !node.position) return;
      const shift = direction * OFFSET_STEP;
      direction *= -1;
      nodeMap.set(entry.id, {
        ...node,
        position: {
          ...node.position,
          x: node.position.x + shift,
        },
      });
    });
  });

  // Recompute layers after offsets and re-apply the constraints.
  layerOf = computeLayerMap(nodeMap);
  applyLayerConstraints(nodeMap, layerOf);

  const adjustStartNodesForTypes = (nodesById: Map<string, Node>, layerMap: Map<string, number>) => {
    const minLayerByType = new Map<string, number>();
    visibleLayerIds.forEach((id) => {
      if (variantOf(id) === 'start') return;
      const layer = layerMap.get(id);
      if (!Number.isFinite(layer)) return;
      const types = getNodeTypes(id);
      types.forEach((type) => {
        const current = minLayerByType.get(type);
        if (current === undefined || (layer as number) < current) {
          minLayerByType.set(type, layer as number);
        }
      });
    });

    visibleLayerIds.forEach((id) => {
      if (variantOf(id) !== 'start') return;
      const types = getNodeTypes(id);
      const targetLayers = types
        .map(t => minLayerByType.get(t))
        .filter((v): v is number => Number.isFinite(v));
      if (targetLayers.length === 0) {
        return;
      }
      const targetLayer = Math.min(...targetLayers) - 1;
      const node = nodesById.get(id);
      if (!node || !node.position) return;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;
      const newCenterY = START_Y + targetLayer * VERTICAL_SPACING;
      layerMap.set(id, targetLayer);
      nodesById.set(id, {
        ...node,
        position: {
          ...node.position,
          y: newCenterY - height / 2,
        },
      });
    });
  };

  adjustStartNodesForTypes(nodeMap, layerOf);
  layerOf = computeLayerMap(nodeMap);

  const adjustedPositionedNodes = Array.from(nodeMap.values());

  const nodesById = new Map(adjustedPositionedNodes.map(n => [n.id, { ...n }]));
  // Index traces by their object type to efficiently look up the relevant sequences
  const traceIndicesByType = new Map<string, number[]>();
  selectedTraces.forEach((trace, idx) => {
    const type = trace.ownerType;
    if (!type) return;
    if (activeTypeSet && !activeTypeSet.has(type)) return;
    const list = traceIndicesByType.get(type) ?? [];
    list.push(idx);
    traceIndicesByType.set(type, list);
  });

  // Find the deepest layer reached by any node in the traces of each object type (excluding end nodes)
  const deepestLayerByType = new Map<string, number>();
  traceIndicesByType.forEach((traceIdxs, type) => {
    let maxLayer = Number.NEGATIVE_INFINITY;
    traceIdxs.forEach((idx) => {
      const trace = traceSequences[idx];
      trace?.forEach((nodeId) => {
        if (variantOf(nodeId) === 'end') {
          return;
        }
        const layer = layerOf.get(nodeId);
        if (typeof layer !== 'number' || !Number.isFinite(layer)) {
          return;
        }
        if (layer > maxLayer) {
          maxLayer = layer;
        }
      });
    });
    if (Number.isFinite(maxLayer)) {
      deepestLayerByType.set(type, maxLayer);
    }
  });

  // Place each end node one layer below the deepest layer of its object type traces
  nodesById.forEach((node, id) => {
    if (variantOf(id) !== 'end' || !node.position) {
      return;
    }
    const types = getNodeTypes(id);
    const candidateLayers = types
      .map(t => deepestLayerByType.get(t))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (candidateLayers.length === 0) {
      return;
    }
    const targetLayer = Math.max(...candidateLayers) + 1;
    const height = node.height ?? DEFAULT_NODE_HEIGHT;
    const newCenterY = START_Y + targetLayer * VERTICAL_SPACING;
    layerOf.set(id, targetLayer);
    nodesById.set(id, {
      ...node,
      position: {
        ...node.position,
        y: newCenterY - height / 2,
      },
    });
  });

  // Refresh layer map after end-node placement
  layerOf = computeLayerMap(nodesById);

  // Final safety: resolve any remaining overlaps by shifting horizontally.
  const resolveOverlaps = (nodes: Map<string, Node>) => {
    const margin = 12; // minimal gap between boxes
    const visible = Array.from(nodes.values()).filter(n =>
      !n.hidden && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
    );
    const maxIterations = 8;
    for (let iter = 0; iter < maxIterations; iter += 1) {
      let moved = false;
      for (let i = 0; i < visible.length; i += 1) {
        const a = visible[i];
        const aw = a.width ?? DEFAULT_NODE_WIDTH;
        const ah = a.height ?? DEFAULT_NODE_HEIGHT;
        const ax1 = a.position!.x;
        const ay1 = a.position!.y;
        const ax2 = ax1 + aw;
        const ay2 = ay1 + ah;
        for (let j = i + 1; j < visible.length; j += 1) {
          const b = visible[j];
          const bw = b.width ?? DEFAULT_NODE_WIDTH;
          const bh = b.height ?? DEFAULT_NODE_HEIGHT;
          const bx1 = b.position!.x;
          const by1 = b.position!.y;
          const bx2 = bx1 + bw;
          const by2 = by1 + bh;
          const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
          const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
          if (overlapX > 0 && overlapY > 0) {
            // Shift the later-index node to the right to clear overlap.
            const shift = overlapX + margin;
            b.position = { ...b.position!, x: b.position!.x + shift };
            nodes.set(b.id, { ...b });
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  };

  resolveOverlaps(nodesById);

  const adjustedNodes = Array.from(nodesById.values());
  const nodeCenters = new Map<string, Point>();
  adjustedNodes.forEach((n) => {
    const width = n.width ?? DEFAULT_NODE_WIDTH;
    const height = n.height ?? DEFAULT_NODE_HEIGHT;
    nodeCenters.set(n.id, {
      x: (n.position?.x ?? 0) + width / 2,
      y: (n.position?.y ?? 0) + height / 2,
    });
  });

  // Build sets of valid edges for each trace (consecutive nodes only)
  const traceEdgeSets = traceSequences.map((trace) => {
    const set = new Set<string>();
    for (let i = 0; i < trace.length - 1; i += 1) {
      const edgeKey = `${trace[i]}->${trace[i + 1]}`;
      set.add(edgeKey);
      // Debug: Log self-loops being added
      if (trace[i] === trace[i + 1]) {
        console.log(`[TRACE DEBUG] Adding self-loop edge to traceEdgeSets: ${edgeKey}`);
      }
    }
    return set;
  });
  const traceOwnerTypes = selectedTraces.map(t => t.ownerType);

  // Debug: Check if any trace contains self-loops
  traceSequences.forEach((trace, idx) => {
    const hasSelfLoop = trace.some((node, i) => i > 0 && trace[i - 1] === node);
    if (hasSelfLoop) {
      console.log(`[TRACE DEBUG] traceSequences[${idx}] contains self-loop:`, trace);
    }
  });

  traceEdgeSets.slice(0, 5).forEach((set, idx) => {
    if (set.size > 0) {
      console.log(`[LONGEST TRACE] Trace #${idx + 1} edges:`, Array.from(set));
    }
  });

  // Split edges by object type - each edge should have only one object type
  // If an edge has multiple object types, create separate edges for each type
  const splitEdgesByObjectType: Edge[] = [];

  // debug: Log all self-loop edges in renderEdges
  const selfLoopEdges = renderEdges.filter(e => e.source === e.target);
  if (selfLoopEdges.length > 0) {
    console.log(`[SELF-LOOP DEBUG] Found ${selfLoopEdges.length} self-loop edges in renderEdges:`, selfLoopEdges.map(e => `${e.source}->${e.target}`));
    selfLoopEdges.forEach(e => {
      const edgeKey = `${e.source}->${e.target}`;
      const inTrace = traceEdgeSets.some(set => set.has(edgeKey));
      console.log(`[SELF-LOOP DEBUG] Edge ${edgeKey}: inTrace=${inTrace}, data=`, e.data);
    });
  }

  renderEdges.forEach(edge => {
    const edgeKey = `${edge.source}->${edge.target}`;

    const membership = traceEdgeSets.map(set => set.has(edgeKey));
    const inAnyTrace = membership.some(Boolean);
    const forceIncludeSelfLoop = edge.source === edge.target;


    if (!inAnyTrace && !forceIncludeSelfLoop) {
      return; // Skip edges not in selected traces
    }

    // Get all owners and group by object type
    const ownersByType = new Map<string, string[]>();
    const ownerPairs = resolveOwnerPairs(
      (edge.data as OwnerEntry | undefined) ?? {},
    );

    ownerPairs.forEach(({ owner, type }) => {
      if (!ownersByType.has(type)) {
        ownersByType.set(type, []);
      }
      ownersByType.get(type)!.push(owner);
    });

    // Create one edge per object type
    ownersByType.forEach((owners, objectType) => {
      if (activeTypeSet && !activeTypeSet.has(objectType)) {
        return;
      }
      const matchesTraceType = forceIncludeSelfLoop
        ? (!activeTypeSet || activeTypeSet.has(objectType))
        : membership.some((isInTrace, traceIdx) =>
            isInTrace && objectType === traceOwnerTypes[traceIdx],
          );

      if (matchesTraceType) {
        splitEdgesByObjectType.push({
          ...edge,
          id: `${edge.id}-${objectType}`,
          data: {
            ...edge.data,
            owners,
            ownerTypes: owners.map(() => objectType),
            objectType, // Store the single object type for this edge
          },
        });
      }
    });
  });

  console.log(`[LONGEST TRACE] Split into ${splitEdgesByObjectType.length} edges (one per object type) from ${renderEdges.length} total`);

  // Detect bidirectional pairs (cycles of length 1 between two nodes)
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const bidirectional = new Map<
    string,
    { a: string; b: string; forward: string[]; backward: string[] }
  >();

  const stableHash = (value: string) => value.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  splitEdgesByObjectType.forEach((edge) => {
    const key = pairKey(edge.source, edge.target);
    const existing = bidirectional.get(key) ?? {
      a: edge.source < edge.target ? edge.source : edge.target,
      b: edge.source < edge.target ? edge.target : edge.source,
      forward: [],
      backward: [],
    };
    if (edge.source === existing.a && edge.target === existing.b) {
      existing.forward.push(edge.id);
    } else if (edge.source === existing.b && edge.target === existing.a) {
      existing.backward.push(edge.id);
    }
    bidirectional.set(key, existing);
  });

  // Pick one bend direction per node pair so the two cycle edges curve to opposite sides.
  const cycleBendDirection = new Map<string, number>();
  bidirectional.forEach((_, key) => {
    const dir = stableHash(key) % 2 === 0 ? 1 : -1;
    cycleBendDirection.set(key, dir);
  });

  const bufferRects = buildBufferRects(adjustedNodes, BUFFER_ZONE_MARGIN);

  const buildCyclePolyline = (src: Point, tgt: Point, bendDir: number): Point[] => {
    const vx = tgt.x - src.x;
    const vy = tgt.y - src.y;
    const vLen = Math.hypot(vx, vy) || 1;
    const nx = -vy / vLen;
    const ny = vx / vLen;
    const bend = Math.max(24, OFFSET_STEP * 0.5);
    // Shared bendDir keeps each direction on opposite sides (normals flip with direction)
    const ctrl1 = { x: src.x + vx * 0.33 + nx * bendDir * bend, y: src.y + vy * 0.33 + ny * bendDir * bend };
    const ctrl2 = { x: src.x + vx * 0.66 + nx * bendDir * bend, y: src.y + vy * 0.66 + ny * bendDir * bend };
    return [src, ctrl1, ctrl2, tgt];
  };

  const enhancedEdges = splitEdgesByObjectType.map(edge => {
    const sourceNode = adjustedNodes.find(n => n.id === edge.source);
    const targetNode = adjustedNodes.find(n => n.id === edge.target);

    if (!sourceNode || !targetNode) {
      return edge;
    }

    const sourceWidth = sourceNode.width || DEFAULT_NODE_WIDTH;
    const sourceHeight = sourceNode.height || DEFAULT_NODE_HEIGHT;
    const targetWidth = targetNode.width || DEFAULT_NODE_WIDTH;
    const targetHeight = targetNode.height || DEFAULT_NODE_HEIGHT;

    // Calculate center points of nodes
    const sourceCenterX = sourceNode.position.x + sourceWidth / 2;
    const sourceCenterY = sourceNode.position.y + sourceHeight / 2;
    const targetCenterX = targetNode.position.x + targetWidth / 2;
    const targetCenterY = targetNode.position.y + targetHeight / 2;

    // Build polyline with optional Bezier-like bend around blockers
    const srcPoint = { x: sourceCenterX, y: sourceCenterY };
    const tgtPoint = { x: targetCenterX, y: targetCenterY };
    let polyline: Point[];
    let polylineKind: 'polyline' | 'bezier' = 'polyline';
    let curveState: EdgeCurveState;

    const pairKeyStr = pairKey(edge.source, edge.target);
    const pair = bidirectional.get(pairKeyStr);
    const isBidirectional =
      pair &&
      pair.forward.length > 0 &&
      pair.backward.length > 0;

    if (isBidirectional) {
      const bendDir = (cycleBendDirection.get(pairKeyStr) ?? 1) as 1 | -1;
      const ctrl = buildCyclePolyline(srcPoint, tgtPoint, bendDir);
      if (ctrl.length === 4) {
        polyline = sampleCubicBezier(
          ctrl[0],
          ctrl[1],
          ctrl[2],
          ctrl[3],
          LONGEST_TRACE_BEZIER_SAMPLES,
        );
        polylineKind = 'bezier';
      } else {
        polyline = ctrl;
      }
      // Store curve state for dynamic routing
      curveState = {
        curveType: 'bidirectional',
        bendDir,
        sourceCenter: srcPoint,
        targetCenter: tgtPoint,
      };
    } else {
      const relaxed = relaxPolylineAroundBuffers(
        [srcPoint, tgtPoint],
        bufferRects,
        edge.source,
        edge.target,
      );
      if (relaxed.length > 2) {
        const a = relaxed[0];
        const d = relaxed[relaxed.length - 1];
        const innerStart = relaxed[1];
        const innerEnd = relaxed[relaxed.length - 2];
        const scale = LONGEST_TRACE_BEZIER_HANDLE_SCALE;
        const b = {
          x: a.x + (innerStart.x - a.x) * scale,
          y: a.y + (innerStart.y - a.y) * scale,
        };
        const c = {
          x: d.x + (innerEnd.x - d.x) * scale,
          y: d.y + (innerEnd.y - d.y) * scale,
        };
        polyline = sampleCubicBezier(a, b, c, d, LONGEST_TRACE_BEZIER_SAMPLES);
        polylineKind = 'bezier';
        // Store curve state with waypoints for collision-based routing
        curveState = {
          curveType: 'collision',
          waypoints: relaxed,
          sourceCenter: srcPoint,
          targetCenter: tgtPoint,
        };
      } else {
        polyline = relaxed;
        // Straight edge - no collision detected
        curveState = {
          curveType: 'straight',
          sourceCenter: srcPoint,
          targetCenter: tgtPoint,
        };
      }
    }

    // Detect self-loops (edge where source === target)
    const isSelfLoop = edge.source === edge.target;

    return {
      ...edge,
      data: {
        ...edge.data,
        polyline,
        edgeKind: isSelfLoop ? 'selfLoop' : 'normal',
        polylineKind,
        curveState, // NEW: Store curve state for dynamic routing
        sourceAnchorOffset: { x: 0, y: 0 },
        targetAnchorOffset: { x: 0, y: 0 },
      },
    };
  });

  // Offset duplicate edges (same source/target but different object types) into parallel lanes.
  const edgesByPair = new Map<string, Edge[]>();
  enhancedEdges.forEach((edge) => {
    const key = `${edge.source}->${edge.target}`;
    if (!edgesByPair.has(key)) {
      edgesByPair.set(key, []);
    }
    edgesByPair.get(key)!.push(edge);
  });

  const unitNormal = (src?: Point, tgt?: Point): Point => {
    if (!src || !tgt) return { x: 0, y: -1 };
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1e-3) return { x: 0, y: -1 };
    return { x: -dy / len, y: dx / len };
  };

  const laneAdjustedEdges = enhancedEdges.map((edge) => {
    const group = edgesByPair.get(`${edge.source}->${edge.target}`);
    if (!group || group.length <= 1) {
      return {
        ...edge,
        data: {
          ...edge.data,
          parallelIndex: 0,      // Single edge, index 0
          parallelCount: 1,      // Only 1 edge in group
        },
      };
    }

    const sorted = [...group].sort((a, b) => {
      const typeA = (a.data as { objectType?: string } | undefined)?.objectType ?? '';
      const typeB = (b.data as { objectType?: string } | undefined)?.objectType ?? '';
      if (typeA === typeB) return a.id.localeCompare(b.id);
      return typeA.localeCompare(typeB);
    });

    const laneIndex = sorted.findIndex(e => e.id === edge.id);
    if (laneIndex < 0) {
      return {
        ...edge,
        data: {
          ...edge.data,
          parallelIndex: 0,            // Fallback to 0
          parallelCount: group.length, // Preserve group size
          overlayDebug: false,
        },
      };
    }

    const basePolyline = (edge.data as { polyline?: Point[] } | undefined)?.polyline;
    if (!basePolyline || basePolyline.length === 0) {
      return {
        ...edge,
        data: {
          ...edge.data,
          overlayDebug: false,
        },
      };
    }

    // Scale lane spacing by rendered stroke width so thicker edges get a wider gap.
    const data = edge.data as { thicknessFactor?: number } | undefined;
    const thicknessFactorRaw = data?.thicknessFactor;
    const thicknessFactor = Number.isFinite(thicknessFactorRaw)
      ? clamp(thicknessFactorRaw, 0.5, 3)
      : 1;
    // Matches OcdfgEdge: strokeBase = 6px * factor, background stroke adds 4px * factor.
    const strokeBase = 6 * thicknessFactor;
    const backgroundStroke = strokeBase + 4 * thicknessFactor;
    const laneSpacing = Math.max(
      LONGEST_TRACE_LANE_OFFSET * 1.35, // strengthen default separation
      backgroundStroke + 6, // leave breathing room beyond the thick background stroke
    );

    // Determine if this is a straight edge (2 points) or curved edge (more points)
    const isStraightEdge = basePolyline.length === 2;

    let offsetVector: Point;

    if (isStraightEdge) {
      // For straight edges: use direction-aligned offset with centering
      // This creates perfect "highway lanes" - parallel and centered
      const centeredOffset = (laneIndex - (group.length - 1) / 2) * laneSpacing;

      if (direction === 'TB') {
        // TB mode: offset horizontally (x-axis only)
        offsetVector = { x: centeredOffset, y: 0 };
      } else {
        // LR mode: offset vertically (y-axis only)
        offsetVector = { x: 0, y: centeredOffset };
      }

      console.log(`[HIGHWAY LANES] Straight edge ${edge.id}: group=${group.length}, laneIndex=${laneIndex}, laneSpacing=${laneSpacing.toFixed(2)}, centeredOffset=${centeredOffset.toFixed(2)}, offsetVector=(${offsetVector.x.toFixed(2)}, ${offsetVector.y.toFixed(2)}), direction=${direction}`);
    } else {
      // For curved edges: use perpendicular offset (existing logic)
      const srcCenter = nodeCenters.get(edge.source);
      const tgtCenter = nodeCenters.get(edge.target);
      const normal = unitNormal(srcCenter, tgtCenter);
      const directionSign = stableHash(`${edge.source}->${edge.target}`) % 2 === 0 ? 1 : -1;
      const offsetMagnitude = laneIndex * laneSpacing * directionSign;
      offsetVector = {
        x: normal.x * offsetMagnitude,
        y: normal.y * offsetMagnitude,
      };
    }

    // Skip if offset is negligible
    if (Math.abs(offsetVector.x) < 1e-6 && Math.abs(offsetVector.y) < 1e-6) {
      return {
        ...edge,
        data: {
          ...edge.data,
          parallelIndex: laneIndex,    // Store parallel metadata even for negligible offset
          parallelCount: group.length, // Needed for parametric edge rendering
          overlayDebug: false,
        },
      };
    }

    const shiftedPolyline = basePolyline.map(p => ({
      x: p.x + offsetVector.x,
      y: p.y + offsetVector.y,
    })) ?? [];

    if (isStraightEdge && group.length > 1) {
      console.log(`[HIGHWAY LANES] Shifted polyline for ${edge.id}:`,
        `base: (${basePolyline[0].x.toFixed(1)}, ${basePolyline[0].y.toFixed(1)}) -> (${basePolyline[1].x.toFixed(1)}, ${basePolyline[1].y.toFixed(1)})`,
        `shifted: (${shiftedPolyline[0].x.toFixed(1)}, ${shiftedPolyline[0].y.toFixed(1)}) -> (${shiftedPolyline[1].x.toFixed(1)}, ${shiftedPolyline[1].y.toFixed(1)})`
      );
    }

    return {
      ...edge,
      data: {
        ...edge.data,
        polyline: shiftedPolyline,
        sourceAnchorOffset: offsetVector,
        targetAnchorOffset: offsetVector,
        parallelIndex: laneIndex,      // Store calculated parallel index
        parallelCount: group.length,   // Store total parallel edge count
        overlayDebug: true,
      },
    };
  });

  console.log(`[LONGEST TRACE] Layout complete with ${adjustedNodes.length} nodes and ${laneAdjustedEdges.length} edges`);

  const visibleNodes = adjustedNodes.filter(n => !n.hidden);
  const terminalFirst = (edges: Edge[]) => {
    const isTerminalEdge = (edge: Edge) => {
      const data = edge.data as { sourceVariant?: string; targetVariant?: string } | undefined;
      return data?.sourceVariant === 'start'
        || data?.sourceVariant === 'end'
        || data?.targetVariant === 'start'
        || data?.targetVariant === 'end';
    };
    return [...edges].sort((a, b) => {
      const ta = isTerminalEdge(a) ? 0 : 1; // terminal edges render first (background)
      const tb = isTerminalEdge(b) ? 0 : 1;
      return ta - tb;
    });
  };
  const axisPositions = layerOf.size > 0
    ? Array.from(
      new Set(
        Array.from(layerOf.values())
          .map((layer) => START_Y + layer * VERTICAL_SPACING)
          .map((val) => Math.round(val * 1000) / 1000),
      ),
    ).sort((a, b) => a - b)
    : Array.from(
      new Set(
        visibleNodes
          .map((node) => {
            const top = node.position?.y ?? 0;
            const height = node.height ?? DEFAULT_NODE_HEIGHT;
            return top + height / 2;
          })
          .map((val) => Math.round(val * 1000) / 1000),
      ),
    ).sort((a, b) => a - b);

  const layerMarkers = includeDebugOverlays ? buildLayerMarkers(axisPositions, visibleNodes, 'TB') : [];
  const bufferZones = includeDebugOverlays ? buildBufferZones(visibleNodes, BUFFER_ZONE_MARGIN) : [];
  const overlayAdjustedEdges = includeDebugOverlays
    ? laneAdjustedEdges
    : laneAdjustedEdges.map(edge => ({
      ...edge,
      data: {
        ...(edge.data ?? {}),
        overlayDebug: false,
      },
    }));

  return {
    nodes: includeDebugOverlays ? [...visibleNodes, ...bufferZones, ...layerMarkers] : [...visibleNodes],
    edges: terminalFirst(overlayAdjustedEdges),
    traceCounts,
  };
}
