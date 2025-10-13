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
import { trimPolyline, type Point } from './edgeGeometry';

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
  layerSep: 180,
  vertexSep: 180,
  borderPadding: 48,
  maxBarycenterIterations: 12,
  objectAttraction: 0.35,
  objectAttractionRangeMin: 1,
  objectAttractionRangeMax: 2,
  preferredSources: [],
  preferredSinks: [],
  activityWidth: 160,
  activityHeight: 70,
  dummyWidth: 60,
  dummyHeight: 40,
};

export async function layoutOCDFG({
  renderNodes,
  renderEdges,
  dfgNodes,
  dfgLinks,
  mode = 'advanced',
  config,
}: LayoutRequest): LayoutResult {
  if (mode === 'naive') {
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
    return {
      ...node,
      position: {
        x: layoutNode.x,
        y: layoutNode.y,
      },
    };
  });

  const enhancedEdges = renderEdges.map((edge) => {
    const layoutEdge = layout.edges[edge.id];
    if (!layoutEdge) {
      return edge;
    }
    const pathNodeIds = [layoutEdge.source, ...layoutEdge.path, layoutEdge.target];
    const polyline: Point[] = pathNodeIds
      .map(nodeId => {
        const n = layout.nodes[nodeId];
        if (!n || n.x === undefined || n.y === undefined) {
          return null;
        }
        return { x: n.x, y: n.y };
      })
      .filter((p): p is Point => p !== null);

    const trimmed = trimPolyline(polyline, 24, 28);

    const owners = layoutEdge.owners && layoutEdge.owners.length > 0
      ? layoutEdge.owners
      : (edge.data as { owners?: string[] } | undefined)?.owners ?? [];

    return {
      ...edge,
      data: {
        ...edge.data,
        owners,
        polyline: trimmed,
      },
    };
  });

  return { nodes: positionedNodes, edges: enhancedEdges };
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
