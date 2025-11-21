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
    const renderWidth = node.width ?? layoutNode.width ?? DEFAULT_NODE_WIDTH;
    const renderHeight = node.height ?? layoutNode.height ?? DEFAULT_NODE_HEIGHT;
    layoutNode.width = renderWidth;
    layoutNode.height = renderHeight;

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
  const layerNodes: Node[] = debugLayers.map(layer => {
    return {
      id: `debug-layer-${layer.layerIndex}`,
      type: 'debugLayer',
      position: {
        x: config.direction === 'TB' ? 0 : layer.axisPosition,
        y: config.direction === 'TB' ? layer.axisPosition : 0,
      },
      data: {
        isLayer: true,
        layerIndex: layer.layerIndex,
        nodeCount: layer.nodeIds.length,
        dummyCount: layer.dummyNodeIds.length,
        direction: config.direction,
      },
      width: 1,
      height: 1,
      draggable: false,
      selectable: false,
      style: {
        zIndex: -2,
      },
    };
  });

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
