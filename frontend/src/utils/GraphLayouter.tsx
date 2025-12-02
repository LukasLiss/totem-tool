import type { Edge, Node } from '@xyflow/react';
import {
  calculateNodeRanks,
  getLayoutedElements,
  type DfgLink,
  type DfgNode,
} from './NaiveOCDFGLayouting';
import {
  type LayoutConfig,
  type LayoutInitData,
  sugiyama,
} from './ocdfgLayout/sugiyama';
import { type Point } from './edgeGeometry';
import type { LayoutNode } from './ocdfgLayout/LayoutState';

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

export type LayoutResult = Promise<{ nodes: Node[]; edges: Edge[] }>;

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

export async function layoutOCDFG({
  renderNodes,
  renderEdges,
  dfgNodes,
  dfgLinks,
  mode = 'advanced',
  config,
}: LayoutRequest): LayoutResult {
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

  return { nodes: positionedNodes, edges: enhancedEdges };
}

function clipPolylineEndpoints(
  points: Point[],
  sourceNode?: LayoutNode,
  targetNode?: LayoutNode,
) {
  if (points.length < 2) return points;
  const clipped = points.map(p => ({ ...p }));

  if (sourceNode && clipped.length >= 2) {
    const margin = getEndpointMargin(sourceNode, true);
    clipped[0] = projectFromCenter(sourceNode, clipped[1], margin);
  }

  if (targetNode && clipped.length >= 2) {
    const margin = getEndpointMargin(targetNode, false);
    clipped[clipped.length - 1] = projectFromCenter(
      targetNode,
      clipped[clipped.length - 2],
      margin,
    );
  }

  return clipped;
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
) {
  const ranks = calculateNodeRanks(dfgNodes, dfgLinks);
  const { nodes, edges } = await getLayoutedElements(renderNodes, renderEdges, ranks);
  const edgeLookup = new Map(edges.map(e => [e.id, e] as const));
  const mergedEdges = renderEdges.map(edge => {
    const elkEdge = edgeLookup.get(edge.id);
    return elkEdge ? { ...edge, ...elkEdge, data: edge.data } : edge;
  });
  return { nodes, edges: mergedEdges };
}
