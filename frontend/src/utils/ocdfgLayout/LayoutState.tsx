import type { Edge, Node } from '@xyflow/react';

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;
const DEFAULT_HORIZONTAL_PADDING = 32;
const DEFAULT_VERTICAL_PADDING = 28;
const TERMINAL_NODE_WIDTH = 80;
const TERMINAL_NODE_HEIGHT = 80;
const TERMINAL_HORIZONTAL_PADDING = 16;
const TERMINAL_VERTICAL_PADDING = 16;
const AVG_CHAR_WIDTH = 7.6;
const AVG_LONG_CHAR_WIDTH = 8.6;
const APPROX_CHARS_PER_LINE = 22;

type StyleRecord = Record<string, unknown>;

type NodeWithMeasurements = Node & {
  width?: number;
  height?: number;
  measured?: {
    width?: number;
    height?: number;
  };
  style?: StyleRecord;
};

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function extractPadding(
  style: StyleRecord | undefined,
  defaults: { horizontal: number; vertical: number },
) {
  if (!style) {
    return defaults;
  }
  const basePadding = toNumber(style.padding);
  const paddingLeft = toNumber(style.paddingLeft) ?? basePadding ?? 0;
  const paddingRight = toNumber(style.paddingRight) ?? basePadding ?? 0;
  const paddingTop = toNumber(style.paddingTop) ?? basePadding ?? 0;
  const paddingBottom = toNumber(style.paddingBottom) ?? basePadding ?? 0;
  const hasHorizontal =
    style.padding !== undefined || style.paddingLeft !== undefined || style.paddingRight !== undefined;
  const hasVertical =
    style.padding !== undefined || style.paddingTop !== undefined || style.paddingBottom !== undefined;
  const horizontalValue = paddingLeft + paddingRight;
  const verticalValue = paddingTop + paddingBottom;
  const horizontal = hasHorizontal ? horizontalValue : defaults.horizontal;
  const vertical = hasVertical ? verticalValue : defaults.vertical;
  return { horizontal, vertical };
}

function estimateLabelWidth(label: string, horizontalPadding: number) {
  const clean = label.trim();
  if (!clean) {
    return DEFAULT_NODE_WIDTH + horizontalPadding;
  }
  const words = clean.split(/\s+/);
  const totalChars = clean.length;
  const longestWord = words.reduce((acc, word) => Math.max(acc, word.length), 0);
  const wordEstimate = longestWord * AVG_LONG_CHAR_WIDTH;
  const totalEstimate = totalChars * AVG_CHAR_WIDTH;
  const contentEstimate = Math.max(DEFAULT_NODE_WIDTH, wordEstimate, totalEstimate * 0.92);
  return contentEstimate + horizontalPadding;
}

function estimateLabelHeight(label: string, verticalPadding: number) {
  const clean = label.trim();
  if (!clean) {
    return DEFAULT_NODE_HEIGHT + verticalPadding;
  }
  const lines = Math.max(1, Math.ceil(clean.length / APPROX_CHARS_PER_LINE));
  const lineHeight = 22;
  const contentEstimate = Math.max(DEFAULT_NODE_HEIGHT, lines * lineHeight);
  return contentEstimate + verticalPadding;
}

function resolveNodeDimensions(renderNode: Node | undefined, label: string) {
  const extended = renderNode as NodeWithMeasurements | undefined;
  const style = (extended?.style && typeof extended.style === 'object')
    ? (extended.style as StyleRecord)
    : undefined;
  const dataRecord = (extended?.data && typeof extended.data === 'object')
    ? (extended.data as Record<string, unknown>)
    : undefined;
  const variantRaw = dataRecord ? dataRecord.nodeVariant : undefined;
  const sizePresetRaw = dataRecord ? dataRecord.sizePreset : undefined;
  const fallbackStart = dataRecord ? Boolean(dataRecord.isStart === true) : false;
  const variant = typeof variantRaw === 'string' ? variantRaw : undefined;
  const sizePreset = typeof sizePresetRaw === 'string' ? sizePresetRaw : undefined;
  const useCompactSizing =
    fallbackStart ||
    variant === 'start' ||
    variant === 'end' ||
    sizePreset === 'terminal';
  const defaultPadding = useCompactSizing
    ? { horizontal: TERMINAL_HORIZONTAL_PADDING, vertical: TERMINAL_VERTICAL_PADDING }
    : { horizontal: DEFAULT_HORIZONTAL_PADDING, vertical: DEFAULT_VERTICAL_PADDING };
  const defaultWidth = useCompactSizing ? TERMINAL_NODE_WIDTH : DEFAULT_NODE_WIDTH;
  const defaultHeight = useCompactSizing ? TERMINAL_NODE_HEIGHT : DEFAULT_NODE_HEIGHT;
  const { horizontal, vertical } = extractPadding(style, defaultPadding);

  const measuredWidth =
    toNumber(extended?.width) ??
    toNumber(extended?.measured?.width);
  const measuredHeight =
    toNumber(extended?.height) ??
    toNumber(extended?.measured?.height);

  const styleWidth =
    measuredWidth === undefined
      ? toNumber(style?.width) ?? toNumber(style?.minWidth) ?? undefined
      : undefined;

  const styleHeight =
    measuredHeight === undefined
      ? toNumber(style?.height) ?? toNumber(style?.minHeight) ?? undefined
      : undefined;

  let width: number;
  if (measuredWidth !== undefined && measuredWidth > 0) {
    width = Math.max(measuredWidth, defaultWidth + horizontal);
  } else if (styleWidth !== undefined && styleWidth > 0) {
    width = Math.max(styleWidth + horizontal, defaultWidth + horizontal);
  } else {
    width = Math.max(defaultWidth + horizontal, estimateLabelWidth(label, horizontal));
  }

  let height: number;
  if (measuredHeight !== undefined && measuredHeight > 0) {
    height = Math.max(measuredHeight, defaultHeight + vertical);
  } else if (styleHeight !== undefined && styleHeight > 0) {
    height = Math.max(styleHeight + vertical, defaultHeight + vertical);
  } else {
    height = Math.max(defaultHeight + vertical, estimateLabelHeight(label, vertical));
  }

  return { width, height };
}

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
  width: number;
  height: number;
  belongsTo?: string;
  upper?: string;
  lower?: string;
  routeVirtual?: boolean;
  variant?: 'start' | 'end' | 'center';
}

export interface LayoutPoint {
  x: number;
  y: number;
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
  polyline?: LayoutPoint[];
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
  static DEFAULT_WIDTH = DEFAULT_NODE_WIDTH;
  static DEFAULT_HEIGHT = DEFAULT_NODE_HEIGHT;

  nodes: Record<string, LayoutNode>;
  edges: Record<string, LayoutEdge>;
  layering: string[][];
  objectTypes: string[];
  layerSizes: LayerSize[];
  direction: LayoutConfig['direction'];
  routingDummies: Record<string, { startId: string; endId: string }>;

  private segmentsCache: Segment[] | null = null;

  constructor(init: LayoutInitData) {
    this.nodes = {};
    this.edges = {};
    this.layering = [];
    this.objectTypes = [];
    this.layerSizes = [];
    this.direction = 'TB';
    this.routingDummies = {};

    const objectTypes = new Set<string>();
    const renderNodeById = new Map<string, Node>();
    init.renderNodes.forEach((renderNode) => {
      if (renderNode?.id) {
        renderNodeById.set(renderNode.id, renderNode);
      }
    });

    init.dfgNodes.forEach((node) => {
      const label = node.label ?? node.id;
      const types = node.types ?? [];
      types.forEach((t) => objectTypes.add(t));
      const renderNode = renderNodeById.get(node.id);
      const dataRecord = (renderNode?.data && typeof renderNode.data === 'object')
        ? (renderNode.data as Record<string, unknown>)
        : undefined;
      const variantRaw = dataRecord?.nodeVariant;
      let variant: 'start' | 'end' | 'center' = 'center';
      if (variantRaw === 'start') {
        variant = 'start';
      } else if (variantRaw === 'end') {
        variant = 'end';
      } else if (dataRecord?.isStart === true) {
        variant = 'start';
      }
      const { width, height } = resolveNodeDimensions(renderNode, label);
      this.nodes[node.id] = {
        id: node.id,
        label,
        objectTypes: [...new Set(types)],
        type: ACTIVITY_TYPE,
        layer: 0,
        pos: 0,
        x: undefined,
        y: undefined,
        width,
        height,
        variant,
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

  clearRoutingDummies() {
    Object.values(this.routingDummies).forEach(({ startId, endId }) => {
      delete this.nodes[startId];
      delete this.nodes[endId];
    });
    this.routingDummies = {};
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
