import type { Edge, Node } from '@xyflow/react';

export interface LayoutConfig {
  direction: 'TB' | 'LR';
  layerSep: number;
  vertexSep: number;
  borderPadding: number;
  maxBarycenterIterations: number;
  objectAttraction: number;
  objectAttractionRangeMin: number;
  objectAttractionRangeMax: number;
  preferredSources: string[];
  preferredSinks: string[];
  activityWidth: number;
  activityHeight: number;
  dummyWidth: number;
  dummyHeight: number;
}

export interface LayoutNode {
  id: string;
  label: string;
  objectTypes: string[];
  type: number;
  layer: number;
  pos: number;
  x: number | undefined;
  y: number | undefined;
  belongsTo?: string;
  upper?: string;
  lower?: string;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  originalSource: string;
  originalTarget: string;
  reversed: boolean;
  owners: string[];
  weight?: number;
  path: string[];
  minLayer: number;
  maxLayer: number;
  original: boolean;
  type1: boolean;
}

export interface LayerSize {
  layer: number;
  size: number;
}

export const ACTIVITY_TYPE = 0;
export const DUMMY_TYPE = 1;

let dummyCounter = 0;
let edgeCounter = 0;

export function resetIdCounters() {
  dummyCounter = 0;
  edgeCounter = 0;
}

export function generateDummyId() {
  return `__dummy_${dummyCounter++}`;
}

export function generateEdgeId() {
  return `__edge_${edgeCounter++}`;
}

export interface LayoutInitData {
  renderNodes: Node[];
  renderEdges: Edge[];
  dfgNodes: {
    id: string;
    label: string;
    types?: string[];
  }[];
  dfgLinks: {
    source: string;
    target: string;
    weight?: number;
    owners?: string[];
    weights?: Record<string, number>;
  }[];
}

interface Segment {
  source: string;
  target: string;
}

export class OCDFGLayout {
  static ACTIVITY_TYPE = ACTIVITY_TYPE;
  static DUMMY_TYPE = DUMMY_TYPE;

  nodes: Record<string, LayoutNode>;
  edges: Record<string, LayoutEdge>;
  layering: string[][];
  objectTypes: string[];
  layerSizes: LayerSize[];

  private segmentsCache: Segment[] | null = null;

  constructor(init: LayoutInitData) {
    this.nodes = {};
    this.edges = {};
    this.layering = [];
    this.objectTypes = [];
    this.layerSizes = [];

    const objectTypes = new Set<string>();

    init.dfgNodes.forEach((node) => {
      const label = node.label ?? node.id;
      const types = node.types ?? [];
      types.forEach((t) => objectTypes.add(t));
      this.nodes[node.id] = {
        id: node.id,
        label,
        objectTypes: [...new Set(types)],
        type: ACTIVITY_TYPE,
        layer: 0,
        pos: 0,
        x: undefined,
        y: undefined,
      };
    });

    if (objectTypes.size === 0) {
      init.dfgLinks.forEach((link) => {
        const owners = link.owners ?? [];
        owners.forEach((owner) => {
          if (this.nodes[link.source] && !this.nodes[link.source].objectTypes.includes(owner)) {
            this.nodes[link.source].objectTypes.push(owner);
          }
          if (this.nodes[link.target] && !this.nodes[link.target].objectTypes.includes(owner)) {
            this.nodes[link.target].objectTypes.push(owner);
          }
          objectTypes.add(owner);
        });
      });
    }

    init.renderEdges.forEach((edge, index) => {
      const link = init.dfgLinks[index];
      const owners = link?.owners ?? [];
      this.edges[edge.id] = {
        id: edge.id,
        source: edge.source ?? '',
        target: edge.target ?? '',
        originalSource: edge.source ?? '',
        originalTarget: edge.target ?? '',
        reversed: false,
        owners,
        weight: link?.weight,
        path: [],
        minLayer: 0,
        maxLayer: 0,
        original: true,
        type1: false,
      };
      owners.forEach((o) => objectTypes.add(o));
    });

    this.objectTypes = [...objectTypes];
  }

  invalidateSegments() {
    this.segmentsCache = null;
  }

  setEdgeDirection(edgeId: string, reversed: boolean) {
    const edge = this.edges[edgeId];
    if (!edge) return;
    edge.reversed = reversed;
    if (reversed) {
      edge.source = edge.originalTarget;
      edge.target = edge.originalSource;
    } else {
      edge.source = edge.originalSource;
      edge.target = edge.originalTarget;
    }
    this.invalidateSegments();
  }

  getAllEdgesBetweenRanks(lowerRank: number) {
    if (lowerRank + 1 >= this.layering.length) return [];
    const upperRank = lowerRank + 1;
    const segments = this.collectSegments();
    return segments.filter((segment) => segment.layer === lowerRank).map((segment) => ({
      source: segment.source,
      target: segment.target,
    }));
  }

  getEdgesBetween(sourceId: string, targetId: string) {
    return Object.values(this.edges).filter(
      (edge) =>
        (edge.source === sourceId && edge.target === targetId) ||
        (edge.source === targetId && edge.target === sourceId),
    );
  }

  getUpperNeighbors(vertexId: string): string[] {
    const vertex = this.nodes[vertexId];
    if (!vertex) return [];
    if (vertex.type === DUMMY_TYPE) {
      if (!vertex.belongsTo) return [];
      const edge = this.edges[vertex.belongsTo];
      if (!edge) return [];
      const idx = edge.path.indexOf(vertexId);
      if (idx === -1) return [];
      const upper = idx === 0 ? edge.source : edge.path[idx - 1];
      return [upper];
    }
    const neighbors: string[] = [];
    Object.values(this.edges).forEach((edge) => {
      if (!edge.original) return;
      if (edge.path.length === 0) {
        if (edge.target === vertexId) {
          neighbors.push(edge.source);
        }
      } else if (edge.target === vertexId) {
        const idx = edge.path.length - 1;
        neighbors.push(edge.path[idx]);
      }
    });
    return neighbors;
  }

  getLowerNeighbors(vertexId: string): string[] {
    const vertex = this.nodes[vertexId];
    if (!vertex) return [];
    if (vertex.type === DUMMY_TYPE) {
      if (!vertex.belongsTo) return [];
      const edge = this.edges[vertex.belongsTo];
      if (!edge) return [];
      const idx = edge.path.indexOf(vertexId);
      if (idx === -1) return [];
      const lower = idx === edge.path.length - 1 ? edge.target : edge.path[idx + 1];
      return [lower];
    }
    const neighbors: string[] = [];
    Object.values(this.edges).forEach((edge) => {
      if (!edge.original) return;
      if (edge.path.length === 0) {
        if (edge.source === vertexId) {
          neighbors.push(edge.target);
        }
      } else if (edge.source === vertexId) {
        neighbors.push(edge.path[0]);
      }
    });
    return neighbors;
  }

  collectSegments() {
    if (this.segmentsCache) return this.segmentsCache;
    const segments: { source: string; target: string; layer: number }[] = [];
    Object.values(this.edges).forEach((edge) => {
      if (!this.nodes[edge.source] || !this.nodes[edge.target]) return;
      const nodesOnPath = [edge.source, ...edge.path, edge.target];
      for (let i = 0; i < nodesOnPath.length - 1; i++) {
        const src = nodesOnPath[i];
        const tgt = nodesOnPath[i + 1];
        const srcLayer = this.nodes[src]?.layer ?? 0;
        const tgtLayer = this.nodes[tgt]?.layer ?? srcLayer;
        if (tgtLayer === srcLayer + 1) {
          segments.push({ source: src, target: tgt, layer: srcLayer });
        }
      }
    });
    this.segmentsCache = segments;
    return segments;
  }

  addDummyNode(node: LayoutNode) {
    this.nodes[node.id] = node;
    this.invalidateSegments();
  }

  addEdge(edge: LayoutEdge) {
    this.edges[edge.id] = edge;
    this.invalidateSegments();
  }

  updateLayering(layering: string[][]) {
    this.layering = layering;
    layering.forEach((layer, layerIndex) => {
      layer.forEach((nodeId, idx) => {
        const node = this.nodes[nodeId];
        if (node) {
          node.layer = layerIndex;
          node.pos = idx;
        }
      });
    });
    this.invalidateSegments();
  }
}

