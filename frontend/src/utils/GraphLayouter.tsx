import type { Edge, Node } from '@xyflow/react';
import {
  calculateNodeRanks,
  getLayoutedElements,
  type DfgLink,
  type DfgNode,
} from './NaiveOCDFGLayouting';
import { type LayoutConfig, type LayoutInitData, sugiyama } from './ocdfgLayout/sugiyama';
import { type Point } from './edgeGeometry';
import type { LayoutNode } from './ocdfgLayout/LayoutState';
import { DUMMY_TYPE } from './ocdfgLayout/LayoutState';

export type { DfgNode, DfgLink } from './NaiveOCDFGLayouting';

type LayoutMode = 'advanced' | 'naive';

export interface LayoutRequest {
  renderNodes: Node[];
  renderEdges: Edge[];
  dfgNodes: DfgNode[];
  dfgLinks: DfgLink[];
  mode?: LayoutMode;
  config?: Partial<LayoutConfig>;
  activeTypes?: string[];
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
}>;

const DEFAULT_CONFIG: LayoutConfig = {
  direction: 'TB',
  layerSep: 140,
  vertexSep: 140,
  borderPadding: 1000,
  maxBarycenterIterations: 12,
  objectAttraction: 3,
  objectAttractionRangeMin: 1,
  objectAttractionRangeMax: 2.5,
  preferredSources: [],
  preferredSinks: [],
  activityWidth: 180,
  activityHeight: 72,
  dummyWidth: 48,
  dummyHeight: 32,
  layeringStrategy: 'auto',
  seeAlignmentType: false,
  alignmentType: 'downLeft',
};

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;
const START_MARGIN = 12;
const END_MARGIN = 18;
const CENTER_MARGIN = 12;
const LANE_TOLERANCE = 1e-3;
const LAYER_MARKER_THICKNESS = 10;
const LAYER_MARKER_PADDING = 60;
const LAYER_MARKER_COLOR = 'rgba(255, 232, 138, 0.45)';

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

export async function layoutOCDFG({
  renderNodes,
  renderEdges,
  dfgNodes,
  dfgLinks,
  mode = 'advanced',
  config,
}: LayoutRequest): LayoutResult {
  console.log(`[LAYOUT START] layoutOCDFG called with ${renderNodes.length} nodes, ${renderEdges.length} edges, mode: ${mode}`);

  if (mode === 'naive') {
    console.info('[OCDFG] using naive');
    return layoutWithNaive(renderNodes, renderEdges, dfgNodes, dfgLinks);
  }

  const mergedConfig: LayoutConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    return await layoutWithSugiyama(renderNodes, renderEdges, dfgNodes, dfgLinks, mergedConfig);
  } catch (error) {
    console.error('[OCDFG] Advanced layout failed, falling back to naive layout.', error);
    return layoutWithNaive(renderNodes, renderEdges, dfgNodes, dfgLinks);
  }
}

export async function layoutOCDFGLongestTrace({
  renderNodes,
  renderEdges,
  dfgNodes,
  dfgLinks,
  activeTypes,
}: Omit<LayoutRequest, 'mode' | 'config'>): LayoutResult {
  console.log(`[LAYOUT LONGEST TRACE] layoutOCDFGLongestTrace called with ${renderNodes.length} nodes, ${renderEdges.length} edges`);

  return layoutWithLongestTrace(renderNodes, renderEdges, dfgNodes, dfgLinks, activeTypes);
}

async function layoutWithSugiyama(
  renderNodes: Node[],
  renderEdges: Edge[],
  dfgNodes: DfgNode[],
  dfgLinks: DfgLink[],
  config: LayoutConfig,
): LayoutResult {
  const init: LayoutInitData = {
    renderNodes,
    renderEdges,
    dfgNodes,
    dfgLinks,
  };

  const layout = await sugiyama(init, config);

  const positionedNodes = renderNodes.map((node) => {
    const layoutNode = layout.nodes[node.id];
    if (!layoutNode || layoutNode.x === undefined || layoutNode.y === undefined) {
      return node;
    }
    const measured = (node as { measured?: { width?: number; height?: number } }).measured;
    const renderWidth = measured?.width
      ?? node.width
      ?? layoutNode.width
      ?? DEFAULT_NODE_WIDTH;
    const renderHeight = measured?.height
      ?? node.height
      ?? layoutNode.height
      ?? DEFAULT_NODE_HEIGHT;
    layoutNode.width = renderWidth;
    layoutNode.height = renderHeight;

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

    const topLeftX = layoutNode.x - renderWidth / 2;
    const topLeftY = layoutNode.y - renderHeight / 2;
    return {
      ...node,
      position: {
        x: topLeftX,
        y: topLeftY,
      },
      width: renderWidth,
      height: renderHeight,
      style: resolvedStyle,
    };
  });

  const enhancedEdges = renderEdges.map((edge) => {
    const layoutEdge = layout.edges[edge.id];
    if (!layoutEdge) {
      return edge;
    }
    const hasPrecomputedPolyline = Array.isArray(layoutEdge.polyline) && layoutEdge.polyline.length >= 2;

    const fallbackPolyline = () => {
      const pathNodeIds = [layoutEdge.source, ...layoutEdge.path, layoutEdge.target];
      return pathNodeIds
        .map(nodeId => {
          const n = layout.nodes[nodeId];
          if (!n || n.x === undefined || n.y === undefined) {
            return null;
          }
          return { x: n.x, y: n.y };
        })
        .filter((p): p is Point => p !== null);
    };

    let centerPolyline: Point[] = hasPrecomputedPolyline
      ? (layoutEdge.polyline ?? [])
        .map(p => ({ x: p.x, y: p.y }))
        .filter((p): p is Point => Number.isFinite(p.x) && Number.isFinite(p.y))
      : fallbackPolyline();

    if (centerPolyline.length < 2) {
      centerPolyline = fallbackPolyline();
    }

    const owners = layoutEdge.owners && layoutEdge.owners.length > 0
      ? layoutEdge.owners
      : (edge.data as { owners?: string[] } | undefined)?.owners ?? [];

    const finalPolyline = clipPolylineEndpoints(
      centerPolyline,
      layout.nodes[layoutEdge.source],
      layout.nodes[layoutEdge.target],
      {
        laneOffset: layoutEdge.laneOffset,
        laneOrientation: layoutEdge.laneOrientation,
      },
    );

    const originalSource = layoutEdge.originalSource ?? layoutEdge.source;
    const originalTarget = layoutEdge.originalTarget ?? layoutEdge.target;
    const isSelfLoop = originalSource === originalTarget;
    const edgeKind = isSelfLoop ? 'selfLoop' : 'normal';

    return {
      ...edge,
      data: {
        ...edge.data,
        owners,
        polyline: finalPolyline,
        edgeKind,
      },
    };
  });

  // Build debug information
  const debugNodes: DebugNodeInfo[] = Object.values(layout.nodes).map(node => ({
    id: node.id,
    isDummy: node.type === DUMMY_TYPE,
    layer: node.layer,
    pos: node.pos,
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width,
    height: node.height,
    isInBundle: node.isInHighwayBundle,
    bundleIndex: node.bundleIndex,
    segmentKey: node.upper && node.lower ? `${node.upper}->${node.lower}` : undefined,
    belongsToEdge: node.belongsTo,
  }));

  // Derive layer axis positions directly from the Sugiyama layout:
  // for each layer, take the median primary-axis coordinate (y for TB, x for LR)
  // of all nodes that belong to that layer.
  const isVertical = config.direction === 'TB';
  const debugLayers: DebugLayerInfo[] = layout.layering.map((layer, index) => {
    const baseNodes = layer
      .map(nodeId => layout.nodes[nodeId])
      .filter((n): n is LayoutNode => Boolean(n));

    const supplementalDummies = Object.values(layout.nodes).filter(
      (node): node is LayoutNode =>
        Boolean(node) &&
        node.type === DUMMY_TYPE &&
        node.layer === index &&
        !layer.includes(node.id),
    );

    const layerNodes = [...baseNodes, ...supplementalDummies];

    const dummyNodes = layerNodes.filter(n => n.type === DUMMY_TYPE);
    const realNodes = layerNodes.filter(n => n.type !== DUMMY_TYPE);

    const axisCoords = (realNodes.length > 0 ? realNodes : layerNodes)
      .map(n => (isVertical ? n.y : n.x))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    let axisPosition: number;
    if (axisCoords.length === 0) {
      // Fallback: approximate based on layer index and configured separation
      axisPosition = index * (config.layerSep || 140);
    } else if (axisCoords.length === 1) {
      axisPosition = axisCoords[0];
    } else {
      const sorted = [...axisCoords].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      axisPosition = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }

    // Group bundles based on contiguous dummy segments
    const bundleMap = new Map<string, string[]>();
    dummyNodes.forEach(node => {
      if (node.isInHighwayBundle && node.upper && node.lower) {
        const segmentKey = `${node.upper}->${node.lower}`;
        const existing = bundleMap.get(segmentKey) || [];
        existing.push(node.id);
        bundleMap.set(segmentKey, existing);
      }
    });

    const bundleGroups = Array.from(bundleMap.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([segmentKey, dummyIds]) => ({
        segmentKey,
        dummyIds,
        bundleSize: dummyIds.length,
      }));

    return {
      layerIndex: index,
      axisPosition,
      nodeIds: realNodes.map(n => n.id),
      dummyNodeIds: dummyNodes.map(n => n.id),
      bundleGroups,
    };
  });

  const debug: DebugData = {
    layers: debugLayers,
    nodes: debugNodes,
    direction: config.direction,
    layerSep: config.layerSep,
    vertexSep: config.vertexSep,
  };

  // Add dummy nodes as visible ReactFlow nodes for debugging
  const BUNDLE_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#EC4899',
    '#8B5CF6', '#14B8A6', '#F97316', '#06B6D4',
  ];

  const dummyReactFlowNodes: Node[] = Object.values(layout.nodes)
    .filter(node => node.type === DUMMY_TYPE)
    .map(node => {
      const size = 16;
      const color = node.isInHighwayBundle
        ? BUNDLE_COLORS[(node.bundleIndex || 0) % BUNDLE_COLORS.length]
        : '#EF4444';

      return {
        id: `debug-dummy-${node.id}`,
        type: 'debugDummy',
        position: {
          x: (node.x ?? 0) - size / 2,
          y: (node.y ?? 0) - size / 2,
        },
        data: {
          isDummy: true,
          isInBundle: node.isInHighwayBundle,
          bundleIndex: node.bundleIndex,
          color,
          belongsToEdge: node.belongsTo,
          segmentKey: node.upper && node.lower ? `${node.upper}->${node.lower}` : undefined,
        },
        width: size,
        height: size,
        draggable: false,
        selectable: false,
        style: {
          width: size,
          height: size,
          zIndex: 1000,
        },
      };
    });

  // Add buffer zone nodes
  const bufferZoneNodes: Node[] = positionedNodes.map(node => {
    const bufferSize = 20;
    return {
      id: `debug-buffer-${node.id}`,
      type: 'debugBuffer',
      position: {
        x: node.position.x - bufferSize,
        y: node.position.y - bufferSize,
      },
      data: {
        isBuffer: true,
        originalNodeId: node.id,
      },
      width: (node.width || 180) + 2 * bufferSize,
      height: (node.height || 72) + 2 * bufferSize,
      draggable: false,
      selectable: false,
      style: {
        width: (node.width || 180) + 2 * bufferSize,
        height: (node.height || 72) + 2 * bufferSize,
        zIndex: -1,
      },
    };
  });

  // Add layer line nodes
  const layerNodes = buildLayerMarkers(
    debugLayers.map(layer => layer.axisPosition),
    positionedNodes,
    config.direction,
  );

  const allNodes = [...positionedNodes, ...bufferZoneNodes, ...dummyReactFlowNodes, ...layerNodes];

  return { nodes: allNodes, edges: enhancedEdges, debug };
}

type LaneEndpointInfo = {
  laneOffset?: number;
  laneOrientation?: 'horizontal' | 'vertical';
};

function clipPolylineEndpoints(
  points: Point[],
  sourceNode?: LayoutNode,
  targetNode?: LayoutNode,
  laneInfo?: LaneEndpointInfo,
) {
  if (points.length < 2) return points;
  const clipped = points.map(p => ({ ...p }));
  const originalStart = points[0];
  const originalSecond = points[1];
  const originalEnd = points[points.length - 1];
  const originalPrev = points[points.length - 2];

  if (sourceNode && clipped.length >= 2) {
    const margin = getEndpointMargin(sourceNode, true);
    const mirrored = mirrorLaneOffsetAtEndpoint(
      sourceNode,
      originalStart,
      originalSecond,
      laneInfo,
      margin,
    );
    clipped[0] = mirrored ?? projectFromCenter(sourceNode, clipped[1], margin);
  }

  if (targetNode && clipped.length >= 2) {
    const margin = getEndpointMargin(targetNode, false);
    const mirrored = mirrorLaneOffsetAtEndpoint(
      targetNode,
      originalEnd,
      originalPrev,
      laneInfo,
      margin,
    );
    clipped[clipped.length - 1] = mirrored
      ?? projectFromCenter(targetNode, clipped[clipped.length - 2], margin);
  }

  return clipped;
}

function mirrorLaneOffsetAtEndpoint(
  node: LayoutNode | undefined,
  endpointPoint: Point | undefined,
  neighborPoint: Point | undefined,
  laneInfo: LaneEndpointInfo | undefined,
  margin: number,
): Point | null {
  if (
    !node
    || node.x === undefined
    || node.y === undefined
    || !endpointPoint
    || !neighborPoint
    || !laneInfo
  ) {
    return null;
  }
  const { laneOffset, laneOrientation } = laneInfo;
  if (!laneOffset || Math.abs(laneOffset) < LANE_TOLERANCE) {
    return null;
  }

  const axis = detectSegmentAxis(endpointPoint, neighborPoint);
  if (!axis) {
    return null;
  }
  if (laneOrientation && laneOrientation !== axis) {
    return null;
  }

  const centerX = node.x;
  const centerY = node.y;
  const halfWidth = (node.width || DEFAULT_NODE_WIDTH) / 2 + margin;
  const halfHeight = (node.height || DEFAULT_NODE_HEIGHT) / 2 + margin;

  if (axis === 'horizontal') {
    const lateralOffset = endpointPoint.y - centerY;
    if (Math.abs(lateralOffset) < LANE_TOLERANCE) {
      return null;
    }
    const direction = neighborPoint.x >= centerX ? 1 : -1;
    const clampedOffset = clamp(
      lateralOffset,
      -halfHeight + LANE_TOLERANCE,
      halfHeight - LANE_TOLERANCE,
    );
    return {
      x: centerX + direction * halfWidth,
      y: centerY + clampedOffset,
    };
  }

  const lateralOffset = endpointPoint.x - centerX;
  if (Math.abs(lateralOffset) < LANE_TOLERANCE) {
    return null;
  }
  const direction = neighborPoint.y >= centerY ? 1 : -1;
  const clampedOffset = clamp(
    lateralOffset,
    -halfWidth + LANE_TOLERANCE,
    halfWidth - LANE_TOLERANCE,
  );
  return {
    x: centerX + clampedOffset,
    y: centerY + direction * halfHeight,
  };
}

function detectSegmentAxis(a?: Point, b?: Point): 'horizontal' | 'vertical' | null {
  if (!a || !b) {
    return null;
  }
  if (Math.abs(a.y - b.y) < LANE_TOLERANCE) {
    return 'horizontal';
  }
  if (Math.abs(a.x - b.x) < LANE_TOLERANCE) {
    return 'vertical';
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getEndpointMargin(node: LayoutNode, isSource: boolean) {
  if (node.variant === 'start' || node.variant === 'end' || node.variant === 'center') {
    return CENTER_MARGIN;
  }
  return isSource ? START_MARGIN : END_MARGIN;
}

function projectFromCenter(node: LayoutNode, towards: Point, margin: number): Point {
  if (node.width === 0 || node.height === 0 || node.x === undefined || node.y === undefined) {
    return { x: towards.x, y: towards.y };
  }

  const center = { x: node.x, y: node.y };
  const dx = center.x - towards.x;
  const dy = center.y - towards.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < 1e-6 && absDy < 1e-6) {
    return { x: center.x, y: center.y };
  }

  const halfWidth = (node.width || DEFAULT_NODE_WIDTH) / 2 + margin;
  const halfHeight = (node.height || DEFAULT_NODE_HEIGHT) / 2 + margin;
  const scale = Math.max(absDx / halfWidth, absDy / halfHeight, 1e-3);

  return {
    x: center.x - dx / scale,
    y: center.y - dy / scale,
  };
}

async function layoutWithNaive(
  renderNodes: Node[],
  renderEdges: Edge[],
  dfgNodes: DfgNode[],
  dfgLinks: DfgLink[],
): LayoutResult {
  const ranks = calculateNodeRanks(dfgNodes, dfgLinks);
  const { nodes, edges } = await getLayoutedElements(renderNodes, renderEdges, ranks);
  const edgeLookup = new Map(edges.map(e => [e.id, e] as const));
  const mergedEdges = renderEdges.map(edge => {
    const elkEdge = edgeLookup.get(edge.id);
    return elkEdge ? { ...edge, ...elkEdge, data: edge.data } : edge;
  });
  return { nodes: nodes as Node[], edges: mergedEdges };
}

async function layoutWithLongestTrace(
  renderNodes: Node[],
  renderEdges: Edge[],
  dfgNodes: DfgNode[],
  dfgLinks: DfgLink[],
  activeTypes?: string[],
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

  // Build a map of edges by their owners (object instances)
  // For each owner, we'll track which edges they followed
  const ownerTraces = new Map<string, Array<{ source: string; target: string; link: DfgLink }>>();

  dfgLinks.forEach(link => {
    const owners = link.owners || [];
    owners.forEach(owner => {
      const ownerType = owner.split('_')[0];
      if (activeTypeSet && !activeTypeSet.has(ownerType)) {
        return;
      }
      if (!ownerTraces.has(owner)) {
        ownerTraces.set(owner, []);
      }
      ownerTraces.get(owner)!.push({ source: link.source, target: link.target, link });
    });
  });

  console.log(`[LONGEST TRACE] Found ${ownerTraces.size} unique object instances`);

  // For each owner, reconstruct their complete trace and collect all traces
  type TraceInfo = {
    trace: string[];
    owner: string;
    length: number;
  };
  const allTraces: TraceInfo[] = [];

  ownerTraces.forEach((edges, owner) => {
    // Build adjacency list for this owner's edges
    const adjacency = new Map<string, string[]>();
    const incomingCount = new Map<string, number>();

    edges.forEach(({ source, target }) => {
      if (!adjacency.has(source)) {
        adjacency.set(source, []);
      }
      adjacency.get(source)!.push(target);

      incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
      if (!incomingCount.has(source)) {
        incomingCount.set(source, 0);
      }
    });

    // Find the start node (node with no incoming edges)
    const startNodes = Array.from(adjacency.keys()).filter(node =>
      (incomingCount.get(node) || 0) === 0
    );

    if (startNodes.length === 0) return; // Skip if no clear start

    // Build the trace by following the path from start
    const trace: string[] = [];
    let current = startNodes[0]; // Take first start node
    const visited = new Set<string>();

    trace.push(current);
    visited.add(current);

    // Follow the path
    while (adjacency.has(current)) {
      const nextNodes = adjacency.get(current)!;
      if (nextNodes.length === 0) break;

      // Take the first unvisited next node (in a proper trace, there should only be one)
      const next = nextNodes.find(n => !visited.has(n));
      if (!next) break;

      trace.push(next);
      visited.add(next);
      current = next;
    }

    // Store this trace
    allTraces.push({
      trace,
      owner,
      length: trace.length,
    });
  });

  // Sort traces by length (descending)
  allTraces.sort((a, b) => b.length - a.length);

  // Get up to four longest traces
  const longestTrace = allTraces[0]?.trace || [];
  const longestOwner = allTraces[0]?.owner || '';
  const secondLongestTrace = allTraces[1]?.trace || [];
  const secondLongestOwner = allTraces[1]?.owner || '';
  const thirdLongestTrace = allTraces[2]?.trace || [];
  const thirdLongestOwner = allTraces[2]?.owner || '';
  const fourthLongestTrace = allTraces[3]?.trace || [];
  const fourthLongestOwner = allTraces[3]?.owner || '';

  console.log(`[LONGEST TRACE] Longest trace has ${longestTrace.length} nodes for owner "${longestOwner}":`, longestTrace);
  console.log(`[LONGEST TRACE] Second longest trace has ${secondLongestTrace.length} nodes for owner "${secondLongestOwner}":`, secondLongestTrace);
  if (thirdLongestTrace.length > 0) {
    console.log(`[LONGEST TRACE] Third longest trace has ${thirdLongestTrace.length} nodes for owner "${thirdLongestOwner}":`, thirdLongestTrace);
  }
  if (fourthLongestTrace.length > 0) {
    console.log(`[LONGEST TRACE] Fourth longest trace has ${fourthLongestTrace.length} nodes for owner "${fourthLongestOwner}":`, fourthLongestTrace);
  }

  // Extract object types
  const longestOwnerType = longestOwner.split('_')[0];
  const secondLongestOwnerType = secondLongestOwner.split('_')[0];
  const thirdLongestOwnerType = thirdLongestOwner.split('_')[0];
  const fourthLongestOwnerType = fourthLongestOwner.split('_')[0];
  console.log(`[LONGEST TRACE] Object type of longest trace: "${longestOwnerType}"`);
  console.log(`[LONGEST TRACE] Object type of second longest trace: "${secondLongestOwnerType}"`);
  if (thirdLongestTrace.length > 0) {
    console.log(`[LONGEST TRACE] Object type of third longest trace: "${thirdLongestOwnerType}"`);
  }
  if (fourthLongestTrace.length > 0) {
    console.log(`[LONGEST TRACE] Object type of fourth longest trace: "${fourthLongestOwnerType}"`);
  }

  // If no trace was found, return empty layout
  if (longestTrace.length === 0) {
    console.warn('[LONGEST TRACE] No valid trace found');
    return { nodes: [], edges: [] };
  }

  const renderNodeById = new Map(renderNodes.map(n => [n.id, n]));
  const visibleNodeIds = new Set<string>([
    ...longestTrace,
    ...secondLongestTrace,
    ...thirdLongestTrace,
    ...fourthLongestTrace,
  ]);

  const getNodeTypes = (nodeId: string): string[] => {
    const node = renderNodeById.get(nodeId);
    const data = node?.data as { types?: string[] } | undefined;
    const types = (data?.types ?? [])
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    return activeTypeSet ? types.filter(type => activeTypeSet.has(type)) : types;
  };

  const includedTypes = new Set<string>();
  visibleNodeIds.forEach((id) => {
    getNodeTypes(id).forEach(t => includedTypes.add(t));
  });
  if (includedTypes.size === 0) {
    if (longestOwnerType && (!activeTypeSet || activeTypeSet.has(longestOwnerType))) includedTypes.add(longestOwnerType);
    if (secondLongestOwnerType && (!activeTypeSet || activeTypeSet.has(secondLongestOwnerType))) includedTypes.add(secondLongestOwnerType);
    if (thirdLongestOwnerType && (!activeTypeSet || activeTypeSet.has(thirdLongestOwnerType))) includedTypes.add(thirdLongestOwnerType);
    if (fourthLongestOwnerType && (!activeTypeSet || activeTypeSet.has(fourthLongestOwnerType))) includedTypes.add(fourthLongestOwnerType);
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

  const computeOrder = (): string[] => {
    if (typeList.length <= 1) return [...typeList];

    const totalWeights = typeList.map((t) => {
      const sum = weights.get(t)
        ? Array.from(weights.get(t)!.values()).reduce((acc, v) => acc + v, 0)
        : 0;
      return { type: t, sum };
    });

    const allZero = totalWeights.every(({ sum }) => sum <= 0);
    if (allZero) {
      return [...typeList].sort();
    }

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
          if (cost < bestCost) {
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
        if (layoutCost(swapped) + 1e-6 < layoutCost(order)) {
          order.splice(0, order.length, ...swapped);
          improved = true;
        }
      }
    }

    return order;
  };

  const typeOrder = computeOrder();

  // Find shared nodes between traces
  const longestTraceSet = new Set(longestTrace);
  const secondLongestTraceSet = new Set(secondLongestTrace);
  const thirdLongestTraceSet = new Set(thirdLongestTrace);
  const fourthLongestTraceSet = new Set(fourthLongestTrace);
  const sharedNodes = new Set<string>();
  [longestTraceSet, secondLongestTraceSet, thirdLongestTraceSet, fourthLongestTraceSet].forEach((setA, idx, arr) => {
    for (const node of setA) {
      for (let j = idx + 1; j < arr.length; j += 1) {
        if (arr[j].has(node)) {
          sharedNodes.add(node);
        }
      }
    }
  });
  console.log(`[LONGEST TRACE] Shared nodes between traces:`, Array.from(sharedNodes));

  // Layout configuration
  const VERTICAL_SPACING = 150;
  const COLUMN_PADDING = 60;
  const COLUMN_SPACING = DEFAULT_NODE_WIDTH * 3 + COLUMN_PADDING; // center-to-center spacing with a full column gap
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
  const firstTraceActivities = longestTrace.filter(nodeId => !isTerminalNode(nodeId));
  const secondTraceActivities = secondLongestTrace.filter(nodeId => !isTerminalNode(nodeId));
  const thirdTraceActivities = thirdLongestTrace.filter(nodeId => !isTerminalNode(nodeId));
  const fourthTraceActivities = fourthLongestTrace.filter(nodeId => !isTerminalNode(nodeId));

  console.log(`[LONGEST TRACE] First trace activities (non-terminal):`, firstTraceActivities);
  console.log(`[LONGEST TRACE] Second trace activities (non-terminal):`, secondTraceActivities);

  // First pass: Position all activity nodes to determine their Y coordinates
  const activityPositions = new Map<string, number>();

  // Calculate Y positions for all activity nodes
  firstTraceActivities.forEach((nodeId, index) => {
    const y = START_Y + index * VERTICAL_SPACING;
    activityPositions.set(nodeId, y);
  });

  secondTraceActivities.forEach((nodeId, index) => {
    if (!activityPositions.has(nodeId)) {
      // Only set if not already set (not shared)
      const y = START_Y + index * VERTICAL_SPACING;
      activityPositions.set(nodeId, y);
    }
  });

  thirdTraceActivities.forEach((nodeId, index) => {
    if (!activityPositions.has(nodeId)) {
      const y = START_Y + index * VERTICAL_SPACING;
      activityPositions.set(nodeId, y);
    }
  });

  fourthTraceActivities.forEach((nodeId, index) => {
    if (!activityPositions.has(nodeId)) {
      const y = START_Y + index * VERTICAL_SPACING;
      activityPositions.set(nodeId, y);
    }
  });

  // Find the Y position of the last activity in each trace
  const lastActivityFirstTrace = firstTraceActivities[firstTraceActivities.length - 1];
  const lastActivitySecondTrace = secondTraceActivities[secondTraceActivities.length - 1];
  const lastActivityThirdTrace = thirdTraceActivities[thirdTraceActivities.length - 1];
  const lastActivityFourthTrace = fourthTraceActivities[fourthTraceActivities.length - 1];

  const lastActivityYFirstTrace = lastActivityFirstTrace
    ? activityPositions.get(lastActivityFirstTrace) || START_Y
    : START_Y;
  const lastActivityYSecondTrace = lastActivitySecondTrace
    ? activityPositions.get(lastActivitySecondTrace) || START_Y
    : START_Y;
  const lastActivityYThirdTrace = lastActivityThirdTrace
    ? activityPositions.get(lastActivityThirdTrace) || START_Y
    : START_Y;
  const lastActivityYFourthTrace = lastActivityFourthTrace
    ? activityPositions.get(lastActivityFourthTrace) || START_Y
    : START_Y;

  // The Y position for end nodes should be after the last activity
  const endNodeY = Math.max(
    lastActivityYFirstTrace,
    lastActivityYSecondTrace,
    lastActivityYThirdTrace,
    lastActivityYFourthTrace,
  ) + VERTICAL_SPACING;

  console.log(
    `[LONGEST TRACE] Last activity Y positions - First: ${lastActivityYFirstTrace}, Second: ${lastActivityYSecondTrace}, Third: ${lastActivityYThirdTrace}, Fourth: ${lastActivityYFourthTrace}, End nodes will be at: ${endNodeY}`,
  );

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

    const indexInFirstTrace = longestTrace.indexOf(node.id);
    const indexInSecondTrace = secondLongestTrace.indexOf(node.id);
    const indexInThirdTrace = thirdLongestTrace.indexOf(node.id);
    const indexInFourthTrace = fourthLongestTrace.indexOf(node.id);
    const isInFirstTrace = indexInFirstTrace !== -1;
    const isInSecondTrace = indexInSecondTrace !== -1;
    const isInThirdTrace = indexInThirdTrace !== -1;
    const isInFourthTrace = indexInFourthTrace !== -1;
    const isShared = sharedNodes.has(node.id);
    const isTerminal = isTerminalNode(node.id);

    if (isInFirstTrace || isInSecondTrace || isInThirdTrace || isInFourthTrace) {
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

  // After initial placement, push nodes downward to discourage upward edges.
  // We only consider edges along the selected traces and enforce a minimum vertical gap.
  const MIN_DOWNWARD_GAP = Math.min(VERTICAL_SPACING * 0.25, 24);
  const traceSequences = [longestTrace, secondLongestTrace, thirdLongestTrace, fourthLongestTrace];
  const visibleIdList = positionedNodes.filter(n => !n.hidden).map(n => n.id);
  const nodeMap = new Map(positionedNodes.map(n => [n.id, { ...n }]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  visibleIdList.forEach((id) => {
    parents.set(id, []);
    children.set(id, []);
    indegree.set(id, 0);
  });

  traceSequences.forEach((trace) => {
    for (let i = 0; i < trace.length - 1; i += 1) {
      const u = trace[i];
      const v = trace[i + 1];
      if (!nodeMap.has(u) || !nodeMap.has(v)) continue;
      parents.get(v)!.push(u);
      children.get(u)!.push(v);
      indegree.set(v, (indegree.get(v) ?? 0) + 1);
    }
  });

  const queue: string[] = [];
  indegree.forEach((deg, id) => {
    if ((deg ?? 0) === 0) queue.push(id);
  });

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentNode = nodeMap.get(currentId);
    if (!currentNode || currentNode.hidden || !currentNode.position) {
      (children.get(currentId) ?? []).forEach((childId) => {
        indegree.set(childId, (indegree.get(childId) ?? 1) - 1);
        if ((indegree.get(childId) ?? 0) === 0) queue.push(childId);
      });
      continue;
    }

    const parentIds = parents.get(currentId) ?? [];
    let maxParentCenter = Number.NEGATIVE_INFINITY;
    parentIds.forEach((pid) => {
      const pn = nodeMap.get(pid);
      if (!pn || pn.hidden || !pn.position) return;
      const ph = pn.height ?? DEFAULT_NODE_HEIGHT;
      const pc = pn.position.y + ph / 2;
      if (pc > maxParentCenter) {
        maxParentCenter = pc;
      }
    });

    if (maxParentCenter > Number.NEGATIVE_INFINITY) {
      const ch = currentNode.height ?? DEFAULT_NODE_HEIGHT;
      const cc = currentNode.position.y + ch / 2;
      const targetCenter = Math.max(cc, maxParentCenter + MIN_DOWNWARD_GAP);
      if (targetCenter - cc > 1e-3) {
        const newY = targetCenter - ch / 2;
        nodeMap.set(currentId, {
          ...currentNode,
          position: {
            ...currentNode.position,
            y: newY,
          },
        });
      }
    }

    (children.get(currentId) ?? []).forEach((childId) => {
      indegree.set(childId, (indegree.get(childId) ?? 1) - 1);
      if ((indegree.get(childId) ?? 0) === 0) queue.push(childId);
    });
  }

  const adjustedPositionedNodes = Array.from(nodeMap.values());

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

  const nodesById = new Map(adjustedPositionedNodes.map(n => [n.id, { ...n }]));
  const lastActivityCenter = (trace: string[]) => {
    for (let i = trace.length - 1; i >= 0; i -= 1) {
      const id = trace[i];
      if (variantOf(id) === 'end') {
        continue;
      }
      const n = nodesById.get(id);
      if (!n || n.hidden || !n.position) {
        continue;
      }
      const h = n.height ?? DEFAULT_NODE_HEIGHT;
      return n.position.y + h / 2;
    }
    return Number.NEGATIVE_INFINITY;
  };

  const adjustEndNodeForTrace = (trace: string[]) => {
    const maxCenter = lastActivityCenter(trace);
    if (!Number.isFinite(maxCenter)) return;
    const endId = [...trace].reverse().find(id => variantOf(id) === 'end');
    if (!endId) return;
    const endNode = nodesById.get(endId);
    if (!endNode || !endNode.position) return;
    const height = endNode.height ?? DEFAULT_NODE_HEIGHT;
    const newCenterY = maxCenter + VERTICAL_SPACING;
    nodesById.set(endId, {
      ...endNode,
      position: {
        ...endNode.position,
        y: newCenterY - height / 2,
      },
    });
  };

  adjustEndNodeForTrace(longestTrace);
  adjustEndNodeForTrace(secondLongestTrace);
  if (thirdLongestTrace.length > 0) {
    adjustEndNodeForTrace(thirdLongestTrace);
  }
  if (fourthLongestTrace.length > 0) {
    adjustEndNodeForTrace(fourthLongestTrace);
  }

  const adjustedNodes = Array.from(nodesById.values());

  // Build sets of valid edges for both traces (consecutive nodes only)
  const firstTraceEdges = new Set<string>();
  for (let i = 0; i < longestTrace.length - 1; i++) {
    const source = longestTrace[i];
    const target = longestTrace[i + 1];
    firstTraceEdges.add(`${source}->${target}`);
  }

  const secondTraceEdges = new Set<string>();
  for (let i = 0; i < secondLongestTrace.length - 1; i++) {
    const source = secondLongestTrace[i];
    const target = secondLongestTrace[i + 1];
    secondTraceEdges.add(`${source}->${target}`);
  }

  const thirdTraceEdges = new Set<string>();
  for (let i = 0; i < thirdLongestTrace.length - 1; i++) {
    const source = thirdLongestTrace[i];
    const target = thirdLongestTrace[i + 1];
    thirdTraceEdges.add(`${source}->${target}`);
  }

  const fourthTraceEdges = new Set<string>();
  for (let i = 0; i < fourthLongestTrace.length - 1; i++) {
    const source = fourthLongestTrace[i];
    const target = fourthLongestTrace[i + 1];
    fourthTraceEdges.add(`${source}->${target}`);
  }

  console.log(`[LONGEST TRACE] First trace edges:`, Array.from(firstTraceEdges));
  console.log(`[LONGEST TRACE] Second trace edges:`, Array.from(secondTraceEdges));
  if (thirdTraceEdges.size > 0) {
    console.log(`[LONGEST TRACE] Third trace edges:`, Array.from(thirdTraceEdges));
  }
  if (fourthTraceEdges.size > 0) {
    console.log(`[LONGEST TRACE] Fourth trace edges:`, Array.from(fourthTraceEdges));
  }

  // Split edges by object type - each edge should have only one object type
  // If an edge has multiple object types, create separate edges for each type
  const splitEdgesByObjectType: Edge[] = [];

  renderEdges.forEach(edge => {
    const edgeKey = `${edge.source}->${edge.target}`;

    // Check if edge belongs to first or second trace
    const inFirstTrace = firstTraceEdges.has(edgeKey);
    const inSecondTrace = secondTraceEdges.has(edgeKey);
    const inThirdTrace = thirdTraceEdges.has(edgeKey);
    const inFourthTrace = fourthTraceEdges.has(edgeKey);

    if (!inFirstTrace && !inSecondTrace && !inThirdTrace && !inFourthTrace) {
      return; // Skip edges not in selected traces
    }

    // Get all owners and group by object type
    const edgeOwners = (edge.data as { owners?: string[] })?.owners || [];
    const ownersByType = new Map<string, string[]>();

    edgeOwners.forEach(owner => {
      const ownerType = owner.split('_')[0];
      if (!ownersByType.has(ownerType)) {
        ownersByType.set(ownerType, []);
      }
      ownersByType.get(ownerType)!.push(owner);
    });

    // Create one edge per object type
    ownersByType.forEach((owners, objectType) => {
      if (activeTypeSet && !activeTypeSet.has(objectType)) {
        return;
      }
      // Include edges that match either trace's object type
      if (
        (inFirstTrace && objectType === longestOwnerType) ||
        (inSecondTrace && objectType === secondLongestOwnerType) ||
        (inThirdTrace && objectType === thirdLongestOwnerType) ||
        (inFourthTrace && objectType === fourthLongestOwnerType)
      ) {
        splitEdgesByObjectType.push({
          ...edge,
          id: `${edge.id}-${objectType}`,
          data: {
            ...edge.data,
            owners,
            objectType, // Store the single object type for this edge
          },
        });
      }
    });
  });

  console.log(`[LONGEST TRACE] Split into ${splitEdgesByObjectType.length} edges (one per object type) from ${renderEdges.length} total`);

  // Create edges with anchoring points at node centers
  // These anchoring points will be relative to node centers and will move with nodes
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

    // Create polyline starting and ending at node centers
    // The OcdfgEdge component will handle the projection to node boundaries
    const polyline: Point[] = [
      { x: sourceCenterX, y: sourceCenterY },
      { x: targetCenterX, y: targetCenterY },
    ];

    return {
      ...edge,
      data: {
        ...edge.data,
        polyline,
        edgeKind: 'normal',
        // Store the anchoring offset from node center (currently 0,0 for center anchoring)
        // This allows future customization of anchoring points within nodes
        sourceAnchorOffset: { x: 0, y: 0 },
        targetAnchorOffset: { x: 0, y: 0 },
      },
    };
  });

  console.log(`[LONGEST TRACE] Layout complete with ${adjustedNodes.length} nodes and ${enhancedEdges.length} edges`);

  const visibleNodes = adjustedNodes.filter(n => !n.hidden);
  const axisPositions = Array.from(
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

  const layerMarkers = buildLayerMarkers(axisPositions, visibleNodes, 'TB');

  return {
    nodes: [...visibleNodes, ...layerMarkers],
    edges: enhancedEdges,
  };
}
