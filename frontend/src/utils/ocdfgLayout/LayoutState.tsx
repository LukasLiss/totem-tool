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
const TERMINAL_EDGE_DISCOUNT = 0.18;
const TERMINAL_OVERLAP_PENALTY = 1200;
const TERMINAL_DEFAULT_SIDE_OFFSET = 140;
const TERMINAL_AXIS_PADDING = 28;

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

interface LayerSummary {
  layer: number;
  minCross: number;
  maxCross: number;
  meanCross: number;
  nodeCount: number;
}

interface CoreMetrics {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  layerSummaries: LayerSummary[];
  hasFiniteData: boolean;
}

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
  objectCentrality?: Record<string, number>;
  includedObjectTypes?: string[];
  seeAlignmentType?: boolean;
  alignmentType?: 'downLeft' | 'downRight' | 'upLeft' | 'upRight';
  layeringStrategy?: 'auto' | 'heuristic' | 'ilp';
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
  isInHighwayBundle?: boolean; // DEBUG: marks if this dummy is part of a highway bundle
  bundleIndex?: number; // DEBUG: which bundle this dummy belongs to
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
  laneOffset?: number;
  laneOrientation?: 'horizontal' | 'vertical';
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
  layer: number;
}

interface TerminalMetadata {
  incoming: string[];
  outgoing: string[];
}

interface TerminalPlacementCandidate {
  node: LayoutNode;
  barycenter: number;
  crossNeighbors: number[];
  axisAnchor: number | null;
  anchorLayer: number;
  isMidLayer: boolean;
  preferredSide: 'left' | 'right' | 'center' | null;
  primaryNeighborId: string | null;
  primaryNeighborCross: number | null;
  primaryNeighborAxis: number | null;
  primaryNeighborWidth: number | null;
  primaryNeighborHeight: number | null;
}

interface DetachedTerminals {
  nodes: Record<string, LayoutNode>;
  edges: Record<string, LayoutEdge>;
  metadata: Record<string, TerminalMetadata>;
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
  coreMetrics: CoreMetrics | null;

  private segmentsCache: Segment[] | null = null;

  constructor(init: LayoutInitData) {
    this.nodes = {};
    this.edges = {};
    this.layering = [];
    this.objectTypes = [];
    this.layerSizes = [];
    this.direction = 'TB';
    this.routingDummies = {};
    this.coreMetrics = null;

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
        objectTypes: Array.from(new Set(types)),
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
        laneOffset: 0,
        laneOrientation: undefined,
      };
      owners.forEach((o) => objectTypes.add(o));
    });

    this.objectTypes = Array.from(objectTypes);
  }

  detachTerminalNodes(): DetachedTerminals | null {
    const terminalEntries = Object.entries(this.nodes).filter(([, node]) => isTerminalNode(node));
    if (terminalEntries.length === 0) {
      return null;
    }

    const metadata: Record<string, TerminalMetadata> = {};
    terminalEntries.forEach(([id]) => {
      metadata[id] = { incoming: [], outgoing: [] };
    });

    Object.values(this.edges).forEach((edge) => {
      if (!edge.original) return;
      const sourceTerminal = metadata[edge.source];
      const targetTerminal = metadata[edge.target];
      if (sourceTerminal && !isTerminalNode(this.nodes[edge.target])) {
        if (!sourceTerminal.outgoing.includes(edge.target)) {
          sourceTerminal.outgoing.push(edge.target);
        }
      }
      if (targetTerminal && !isTerminalNode(this.nodes[edge.source])) {
        if (!targetTerminal.incoming.includes(edge.source)) {
          targetTerminal.incoming.push(edge.source);
        }
      }
    });

    const detachedNodes: Record<string, LayoutNode> = {};
    terminalEntries.forEach(([id, node]) => {
      detachedNodes[id] = cloneLayoutNode(node);
      delete this.nodes[id];
    });

    const detachedEdges: Record<string, LayoutEdge> = {};
    Object.entries(this.edges).forEach(([edgeId, edge]) => {
      if (detachedNodes[edge.source] || detachedNodes[edge.target]) {
        detachedEdges[edgeId] = cloneLayoutEdge(edge);
        delete this.edges[edgeId];
      }
    });

    this.layering = this.layering
      .map((layer) => layer.filter((id) => !detachedNodes[id]))
      .filter((layer) => layer.length > 0);
    this.layerSizes = [];
    this.invalidateSegments();

    return { nodes: detachedNodes, edges: detachedEdges, metadata };
  }

  attachTerminalNodes(detached: DetachedTerminals | null, config: LayoutConfig) {
    if (!detached) return;
    const nodeEntries = Object.entries(detached.nodes);
    if (nodeEntries.length === 0) {
      return;
    }

    const startNodes: LayoutNode[] = [];
    const endNodes: LayoutNode[] = [];
    const terminalMetadata = detached.metadata ?? {};

    nodeEntries.forEach(([id, saved]) => {
      const restored = cloneLayoutNode(saved);
      this.nodes[id] = restored;
      if (restored.variant === 'start') {
        startNodes.push(restored);
      } else if (restored.variant === 'end') {
        endNodes.push(restored);
      }
    });

    const metrics = this.ensureCoreMetrics(config);
    const startCandidates = buildTerminalPlacementCandidates(
      this,
      startNodes,
      terminalMetadata,
      config,
      -1,
      metrics,
    );
    const endCandidates = buildTerminalPlacementCandidates(
      this,
      endNodes,
      terminalMetadata,
      config,
      1,
      metrics,
    );

    const updatedLayering = this.layering.map((layer) => [...layer]);
    if (startCandidates.length > 0) {
      updatedLayering.unshift(startCandidates.map((candidate) => candidate.node.id));
    }
    if (endCandidates.length > 0) {
      updatedLayering.push(endCandidates.map((candidate) => candidate.node.id));
    }
    this.updateLayering(updatedLayering);

    Object.entries(detached.edges).forEach(([id, saved]) => {
      const restored = cloneLayoutEdge(saved);
      const sourceLayer = this.nodes[restored.source]?.layer ?? 0;
      const targetLayer = this.nodes[restored.target]?.layer ?? 0;
      restored.minLayer = Math.min(sourceLayer, targetLayer);
      restored.maxLayer = Math.max(sourceLayer, targetLayer);
      restored.path = [];
      this.edges[id] = restored;
    });

    this.recalculateLayerSizes(config);

    if (startCandidates.length > 0) {
      positionTerminalGroup(this, startCandidates, config, -1, metrics);
    }
    if (endCandidates.length > 0) {
      positionTerminalGroup(this, endCandidates, config, 1, metrics);
    }

    this.invalidateSegments();
  }

  recalculateLayerSizes(config: LayoutConfig) {
    this.layerSizes = this.layering.map((layer, index) => {
      let halfSize = 0;
      layer.forEach((nodeId) => {
        const node = this.nodes[nodeId];
        if (!node) return;
        const dimension = this.direction === 'TB'
          ? (node.height ?? config.activityHeight) / 2
          : (node.width ?? config.activityWidth) / 2;
        if (dimension > halfSize) {
          halfSize = dimension;
        }
      });
      return { layer: index, size: halfSize * 2 };
    });
  }

  computeCoreMetrics(config: LayoutConfig) {
    const metrics = calculateCoreMetrics(this, config);
    this.coreMetrics = metrics;
    if (metrics.hasFiniteData) {
      console.debug('[OCDFG] core metrics', {
        bounds: {
          minX: metrics.minX.toFixed(2),
          maxX: metrics.maxX.toFixed(2),
          minY: metrics.minY.toFixed(2),
          maxY: metrics.maxY.toFixed(2),
        },
        layerSummaries: metrics.layerSummaries.map((summary) => ({
          layer: summary.layer,
          min: summary.minCross.toFixed(2),
          max: summary.maxCross.toFixed(2),
          mean: summary.meanCross.toFixed(2),
          count: summary.nodeCount,
        })),
      });
    } else {
      console.debug('[OCDFG] core metrics fallback applied');
    }
  }

  ensureCoreMetrics(config: LayoutConfig): CoreMetrics {
    if (!this.coreMetrics) {
      this.computeCoreMetrics(config);
    }
    return this.coreMetrics ?? defaultCoreMetrics(config);
  }

  invalidateSegments() {
    this.segmentsCache = null;
    this.coreMetrics = null;
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

function isTerminalNode(node: LayoutNode | undefined) {
  return node?.variant === 'start' || node?.variant === 'end';
}

function cloneLayoutNode(node: LayoutNode): LayoutNode {
  return { ...node };
}

function cloneLayoutEdge(edge: LayoutEdge): LayoutEdge {
  return {
    ...edge,
    owners: [...edge.owners],
    path: [...edge.path],
    polyline: edge.polyline ? edge.polyline.map((point) => ({ ...point })) : undefined,
    laneOffset: edge.laneOffset,
    laneOrientation: edge.laneOrientation,
  };
}

function positionTerminalGroup(
  layout: OCDFGLayout,
  candidates: TerminalPlacementCandidate[],
  config: LayoutConfig,
  directionFactor: -1 | 1,
  metrics: CoreMetrics,
) {
  if (candidates.length === 0) return;

  const isVertical = config.direction === 'TB';
  const axisMin = isVertical ? metrics.minY : metrics.minX;
  const axisMax = isVertical ? metrics.maxY : metrics.maxX;
  const crossMin = isVertical ? metrics.minX : metrics.minY;
  const crossMax = isVertical ? metrics.maxX : metrics.maxY;
  const crossCenter = isVertical ? metrics.centerX : metrics.centerY;
  const placed: { value: number; radius: number }[] = [];
  const sideOccupancy = { left: 0, right: 0 };

  candidates.forEach((candidate) => {
    const node = candidate.node;
    const crossHalf = isVertical
      ? (node.width ?? config.activityWidth) / 2
      : (node.height ?? config.activityHeight) / 2;
    const axisHalf = isVertical
      ? (node.height ?? config.activityHeight) / 2
      : (node.width ?? config.activityWidth) / 2;

    const axisPadding = config.layerSep + axisHalf + TERMINAL_AXIS_PADDING;
    let axisCoordinate = directionFactor < 0
      ? axisMin - axisPadding
      : axisMax + axisPadding;

    let isMidLayer = candidate.isMidLayer;
    if (isMidLayer && candidate.axisAnchor !== null) {
      axisCoordinate = clamp(candidate.axisAnchor, axisMin, axisMax);
    } else if (candidate.axisAnchor !== null) {
      const projected = clamp(candidate.axisAnchor, axisMin, axisMax);
      if (projected >= axisMin && projected <= axisMax) {
        // If the anchor sits inside core bounds, treat as mid-layer terminal.
        isMidLayer = true;
        axisCoordinate = projected;
      }
    }

    const radius = crossHalf + config.vertexSep / 2;

    if (directionFactor < 0 && config.direction === 'TB') {
      const directPlacement = tryPlaceDirectlyAbove(
        candidate,
        axisHalf,
        crossHalf,
        config,
        placed,
        radius,
      );
      if (directPlacement) {
        placed.push({ value: directPlacement.cross, radius });
        if (isVertical) {
          node.x = directPlacement.cross;
          node.y = directPlacement.axis;
        } else {
          node.x = directPlacement.axis;
          node.y = directPlacement.cross;
        }

        console.debug('[OCDFG] terminal placement', {
          id: node.id,
          variant: node.variant,
          axis: directPlacement.axis.toFixed(2),
          cross: directPlacement.cross.toFixed(2),
          side: 'directAbove',
          midLayer: isMidLayer,
          anchorNeighbor: candidate.primaryNeighborId,
        });
        return;
      }
    }

    const options = buildCrossPlacementOptions(
      candidate,
      crossMin,
      crossMax,
      crossCenter,
      crossHalf,
      sideOccupancy,
      config,
      isMidLayer,
    );
    const choice = selectBestCrossPlacement(
      options,
      candidate,
      placed,
      radius,
    );

    if (choice.side === 'left') {
      sideOccupancy.left += 1;
    } else if (choice.side === 'right') {
      sideOccupancy.right += 1;
    }

    const alignedCross = choice.value;
    placed.push({ value: alignedCross, radius });

    if (isVertical) {
      node.x = alignedCross;
      node.y = axisCoordinate;
    } else {
      node.x = axisCoordinate;
      node.y = alignedCross;
    }

    const nudgedAxis = maybeOffsetTerminalAxis(
      layout,
      node,
      candidate,
      config,
      directionFactor,
      axisCoordinate,
      alignedCross,
      axisHalf,
      crossHalf,
      choice.side,
      axisMin,
      axisMax,
    );
    let finalAxis = axisCoordinate;
    if (nudgedAxis !== null) {
      finalAxis = nudgedAxis;
      if (isVertical) {
        node.y = nudgedAxis;
      } else {
        node.x = nudgedAxis;
      }
    }

    console.debug('[OCDFG] terminal placement', {
      id: node.id,
      variant: node.variant,
      axis: finalAxis.toFixed(2),
      cross: alignedCross.toFixed(2),
      side: choice.side,
      midLayer: isMidLayer,
      anchorNeighbor: candidate.primaryNeighborId,
      nudged: nudgedAxis !== null,
    });
  });
}

function maybeOffsetTerminalAxis(
  layout: OCDFGLayout,
  node: LayoutNode,
  candidate: TerminalPlacementCandidate,
  config: LayoutConfig,
  directionFactor: -1 | 1,
  currentAxis: number,
  crossCoordinate: number,
  axisHalf: number,
  crossHalf: number,
  placementSide: 'left' | 'right' | 'center',
  axisMin: number,
  axisMax: number,
): number | null {
  const isVertical = config.direction === 'TB';
  if ((directionFactor < 0 && node.variant !== 'start') || (directionFactor > 0 && node.variant !== 'end')) {
    return null;
  }
  if (!candidate.isMidLayer || placementSide === 'center') {
    return null;
  }
  if (!Number.isFinite(currentAxis) || !Number.isFinite(crossCoordinate)) {
    return null;
  }

  const layerIndex = Math.min(
    Math.max(candidate.anchorLayer, 0),
    layout.layering.length > 0 ? layout.layering.length - 1 : 0,
  );
  const adjacentLayerIndex = directionFactor < 0 ? layerIndex - 1 : layerIndex + 1;
  if (adjacentLayerIndex < 0 || adjacentLayerIndex >= layout.layerSizes.length) {
    return null;
  }

  const currentLayerHalf = getLayerHalfSize(layout, layerIndex, config);
  const adjacentLayerHalf = getLayerHalfSize(layout, adjacentLayerIndex, config);
  const desiredShift = (currentLayerHalf + adjacentLayerHalf + config.layerSep) / 2;
  if (!Number.isFinite(desiredShift) || desiredShift <= 0) {
    return null;
  }

  const axisPadding = config.layerSep + axisHalf + TERMINAL_AXIS_PADDING;
  const minAllowed = axisMin - axisPadding;
  const maxAllowed = axisMax + axisPadding;
  const proposedAxis = clamp(
    currentAxis + directionFactor * desiredShift,
    minAllowed,
    maxAllowed,
  );

  if (Math.abs(proposedAxis - currentAxis) < 1e-3) {
    return null;
  }

  const hasSpace = hasAxisClearance(
    layout,
    node,
    crossCoordinate,
    crossHalf,
    axisHalf,
    proposedAxis,
    config,
  );
  if (!hasSpace) {
    return null;
  }
  return proposedAxis;
}

function hasAxisClearance(
  layout: OCDFGLayout,
  node: LayoutNode,
  crossCenter: number,
  crossHalf: number,
  axisHalf: number,
  newAxis: number,
  config: LayoutConfig,
): boolean {
  const isVertical = config.direction === 'TB';
  const axisClearance = Math.max(config.vertexSep * 0.25, 12);
  const crossClearance = Math.max(config.vertexSep * 0.25, 12);

  const newAxisMin = newAxis - axisHalf - axisClearance;
  const newAxisMax = newAxis + axisHalf + axisClearance;
  const newCrossMin = crossCenter - crossHalf - crossClearance;
  const newCrossMax = crossCenter + crossHalf + crossClearance;

  return !Object.values(layout.nodes).some((other) => {
    if (!other || other.id === node.id) return false;
    if (!isFiniteNumber(other.x) || !isFiniteNumber(other.y)) return false;

    const { width: otherWidth, height: otherHeight } = getNodeDimensions(other, config);
    const otherCrossCenter = isVertical ? (other.x ?? 0) : (other.y ?? 0);
    const otherAxisCenter = isVertical ? (other.y ?? 0) : (other.x ?? 0);
    const otherCrossHalf = isVertical ? otherWidth / 2 : otherHeight / 2;
    const otherAxisHalf = isVertical ? otherHeight / 2 : otherWidth / 2;

    const otherAxisMin = otherAxisCenter - otherAxisHalf;
    const otherAxisMax = otherAxisCenter + otherAxisHalf;
    const otherCrossMin = otherCrossCenter - otherCrossHalf;
    const otherCrossMax = otherCrossCenter + otherCrossHalf;

    const crossOverlap = !(newCrossMax <= otherCrossMin || newCrossMin >= otherCrossMax);
    if (!crossOverlap) return false;

    const axisOverlap = !(newAxisMax <= otherAxisMin || newAxisMin >= otherAxisMax);
    return axisOverlap;
  });
}

function getNodeDimensions(node: LayoutNode, config: LayoutConfig) {
  let width = node.width;
  if (!isFiniteNumber(width) || width <= 0) {
    if (node.variant === 'start' || node.variant === 'end') {
      width = TERMINAL_NODE_WIDTH;
    } else if (node.type === DUMMY_TYPE) {
      width = config.dummyWidth;
    } else {
      width = config.activityWidth;
    }
  }

  let height = node.height;
  if (!isFiniteNumber(height) || height <= 0) {
    if (node.variant === 'start' || node.variant === 'end') {
      height = TERMINAL_NODE_HEIGHT;
    } else if (node.type === DUMMY_TYPE) {
      height = config.dummyHeight;
    } else {
      height = config.activityHeight;
    }
  }

  const resolvedWidth = isFiniteNumber(width) ? width : config.activityWidth;
  const resolvedHeight = isFiniteNumber(height) ? height : config.activityHeight;
  return { width: resolvedWidth, height: resolvedHeight };
}

function getLayerHalfSize(layout: OCDFGLayout, layerIndex: number, config: LayoutConfig) {
  const entry = layout.layerSizes[layerIndex];
  if (entry && isFiniteNumber(entry.size) && entry.size > 0) {
    return entry.size / 2;
  }

  const layer = layout.layering[layerIndex];
  if (layer && layer.length > 0) {
    for (const nodeId of layer) {
      const node = layout.nodes[nodeId];
      if (!node) continue;
      const dimension = config.direction === 'TB'
        ? node.height
        : node.width;
      if (isFiniteNumber(dimension) && dimension > 0) {
        return dimension / 2;
      }
    }
  }

  if (config.direction === 'TB') {
    return config.activityHeight / 2;
  }
  return config.activityWidth / 2;
}

function buildCrossPlacementOptions(
  candidate: TerminalPlacementCandidate,
  crossMin: number,
  crossMax: number,
  crossCenter: number,
  crossHalf: number,
  sideOccupancy: { left: number; right: number },
  config: LayoutConfig,
  isMidLayer: boolean,
) {
  const options: { side: 'left' | 'right' | 'center'; value: number }[] = [];
  const barycenter = Number.isFinite(candidate.barycenter)
    ? clamp(candidate.barycenter, crossMin, crossMax)
    : crossCenter;

  const lateralStep = crossHalf * 2 + config.vertexSep;

  if (!isMidLayer && candidate.primaryNeighborCross !== null) {
    const center = candidate.primaryNeighborCross;
    const leftStep = lateralStep * Math.max(1, sideOccupancy.left + 1);
    const rightStep = lateralStep * Math.max(1, sideOccupancy.right + 1);
    options.push({ side: 'center', value: center });
    options.push({ side: 'left', value: center - leftStep });
    options.push({ side: 'right', value: center + rightStep });
    return options;
  }

  const leftValue = crossMin - (TERMINAL_DEFAULT_SIDE_OFFSET + sideOccupancy.left * lateralStep);
  const rightValue = crossMax + (TERMINAL_DEFAULT_SIDE_OFFSET + sideOccupancy.right * lateralStep);

  if (!isMidLayer || candidate.preferredSide === 'center') {
    options.push({ side: 'center', value: barycenter });
  }

  const prefer = candidate.preferredSide ?? (barycenter <= crossCenter ? 'left' : 'right');
  if (!isMidLayer || prefer === 'left') {
    options.push({ side: 'left', value: leftValue });
  }
  if (!isMidLayer || prefer === 'right') {
    options.push({ side: 'right', value: rightValue });
  }

  if (isMidLayer) {
    const preferredOption = options.find((opt) => opt.side === prefer);
    if (preferredOption) {
      return [preferredOption];
    }
  }

  return options;
}

function selectBestCrossPlacement(
  options: { side: 'left' | 'right' | 'center'; value: number }[],
  candidate: TerminalPlacementCandidate,
  placed: { value: number; radius: number }[],
  radius: number,
) {
  let best = options[0];
  let bestCost = Number.POSITIVE_INFINITY;

  options.forEach((option) => {
    let cost = 0;
    const neighborPenalty = candidate.crossNeighbors.reduce(
      (sum, val) => sum + Math.abs(option.value - val),
      0,
    );
    if (neighborPenalty > 0) {
      cost += neighborPenalty * TERMINAL_EDGE_DISCOUNT;
    } else {
      cost += Math.abs(option.value - candidate.barycenter) * 0.05;
    }

    placed.forEach((other) => {
      const clearance = Math.abs(option.value - other.value) - (radius + other.radius);
      if (clearance < 0) {
        cost += TERMINAL_OVERLAP_PENALTY * Math.abs(clearance);
      }
    });

    const barycenterDelta = Math.abs(option.value - candidate.barycenter);
    cost += barycenterDelta * 0.02;

    if (cost < bestCost - 1e-6) {
      bestCost = cost;
      best = option;
    }
  });

  return best;
}

function tryPlaceDirectlyAbove(
  candidate: TerminalPlacementCandidate,
  axisHalf: number,
  crossHalf: number,
  config: LayoutConfig,
  placed: { value: number; radius: number }[],
  radius: number,
) {
  if (candidate.node.variant !== 'start') {
    return null;
  }
  if (candidate.primaryNeighborCross === null || candidate.primaryNeighborAxis === null) {
    return null;
  }

  const crossCenter = candidate.primaryNeighborCross;
  const neighborWidth = candidate.primaryNeighborWidth ?? config.activityWidth;
  const neighborHeight = candidate.primaryNeighborHeight ?? config.activityHeight;
  if (
    !isFiniteNumber(crossCenter) ||
    !isFiniteNumber(neighborWidth) ||
    neighborWidth <= 0 ||
    !isFiniteNumber(neighborHeight) ||
    neighborHeight <= 0
  ) {
    return null;
  }

  const neighborLeft = crossCenter - neighborWidth / 2;
  const leftBound = neighborLeft - neighborWidth * 0.6;
  const rightBound = neighborLeft + neighborWidth + neighborWidth * 0.6;
  const candidateLeft = crossCenter - crossHalf;
  const candidateRight = crossCenter + crossHalf;

  if (candidateLeft < leftBound || candidateRight > rightBound) {
    return null;
  }

  const spacingLeft = crossCenter - radius;
  const spacingRight = crossCenter + radius;
  if (spacingLeft < leftBound || spacingRight > rightBound) {
    return null;
  }
  const overlapsExisting = placed.some((other) => {
    const otherLeft = other.value - other.radius;
    const otherRight = other.value + other.radius;
    return !(spacingRight <= otherLeft || spacingLeft >= otherRight);
  });
  if (overlapsExisting) {
    return null;
  }

  if (!isFiniteNumber(candidate.primaryNeighborAxis)) {
    return null;
  }
  const neighborAxis = candidate.primaryNeighborAxis;
  const axisCoordinate = neighborAxis - (neighborHeight / 2 + config.layerSep + axisHalf);

  if (!isFiniteNumber(axisCoordinate)) {
    return null;
  }

  return {
    axis: axisCoordinate,
    cross: crossCenter,
  };
}

function buildTerminalPlacementCandidates(
  layout: OCDFGLayout,
  nodes: LayoutNode[],
  metadata: Record<string, TerminalMetadata>,
  config: LayoutConfig,
  directionFactor: -1 | 1,
  metrics: CoreMetrics,
): TerminalPlacementCandidate[] {
  const isVertical = config.direction === 'TB';
  const axisMin = isVertical ? metrics.minY : metrics.minX;
  const axisMax = isVertical ? metrics.maxY : metrics.maxX;
  const crossCenter = isVertical ? metrics.centerX : metrics.centerY;

  const candidates = nodes.map((node) => {
    const meta = metadata[node.id] ?? { incoming: [], outgoing: [] };
    const neighborIds = directionFactor < 0 ? meta.outgoing : meta.incoming;
    const neighborDetails = neighborIds
      .map((id) => {
        const neighbor = layout.nodes[id];
        if (!neighbor || !isFiniteNumber(neighbor.x) || !isFiniteNumber(neighbor.y)) {
          return null;
        }
        const width = neighbor.width ?? config.activityWidth;
        const height = neighbor.height ?? config.activityHeight;
        const crossValue = isVertical
          ? (neighbor.x ?? 0)
          : (neighbor.y ?? 0);
        const axisValue = isVertical
          ? (neighbor.y ?? 0)
          : (neighbor.x ?? 0);
        return {
          id,
          crossValue,
          axisValue,
          width,
          height,
          layer: neighbor.layer,
        };
      })
      .filter((detail): detail is {
        id: string;
        crossValue: number;
        axisValue: number;
        width: number;
        height: number;
        layer: number | undefined;
      } => detail !== null);

    const crossNeighbors = neighborDetails.map((detail) => detail.crossValue);
    const axisNeighbors = neighborDetails.map((detail) => detail.axisValue);
    const barycenter = crossNeighbors.length > 0 ? average(crossNeighbors) : crossCenter;

    const neighborLayers = neighborDetails
      .map((detail) => detail.layer)
      .filter((layer): layer is number => typeof layer === 'number' && Number.isFinite(layer));

    const anchorLayer = neighborLayers.length > 0
      ? (directionFactor < 0 ? Math.min(...neighborLayers) : Math.max(...neighborLayers))
      : (directionFactor < 0 ? 0 : Math.max(layout.layering.length - 1, 0));

    const anchorAxis = axisNeighbors.length > 0
      ? (directionFactor < 0 ? Math.min(...axisNeighbors) : Math.max(...axisNeighbors))
      : null;

    const hasBothDirections = meta.incoming.length > 0 && meta.outgoing.length > 0;
    const axisFallback = directionFactor < 0
      ? axisMin - config.layerSep * 2
      : axisMax + config.layerSep * 2;
    const axisValueForCheck = anchorAxis ?? axisFallback;
    const insideCore = axisValueForCheck >= axisMin - 1e-3 && axisValueForCheck <= axisMax + 1e-3;
    const isMidLayer = hasBothDirections || insideCore;

    const preferredSide: 'left' | 'right' | 'center' | null = isMidLayer
      ? (barycenter <= crossCenter ? 'left' : 'right')
      : null;

    const primaryNeighbor = neighborDetails[0] ?? null;

    return {
      node,
      barycenter,
      crossNeighbors,
      axisAnchor: anchorAxis,
      anchorLayer,
      isMidLayer,
      preferredSide,
      primaryNeighborId: primaryNeighbor?.id ?? null,
      primaryNeighborCross: primaryNeighbor?.crossValue ?? null,
      primaryNeighborAxis: primaryNeighbor?.axisValue ?? null,
      primaryNeighborWidth: primaryNeighbor?.width ?? null,
      primaryNeighborHeight: primaryNeighbor?.height ?? null,
    } satisfies TerminalPlacementCandidate;
  });

  candidates.sort((a, b) => {
    if (a.anchorLayer !== b.anchorLayer) {
      return a.anchorLayer - b.anchorLayer;
    }
    if (Math.abs(a.barycenter - b.barycenter) > 1e-6) {
      return a.barycenter - b.barycenter;
    }
    return a.node.id.localeCompare(b.node.id);
  });

  console.debug('[OCDFG] terminal anchors', candidates.map((candidate) => ({
    id: candidate.node.id,
    variant: candidate.node.variant,
    anchorLayer: candidate.anchorLayer,
    barycenter: candidate.barycenter.toFixed(2),
    axisAnchor: candidate.axisAnchor !== null ? candidate.axisAnchor.toFixed(2) : null,
    midLayer: candidate.isMidLayer,
    preferredSide: candidate.preferredSide,
  })));

  return candidates;
}

function calculateCoreMetrics(layout: OCDFGLayout, config: LayoutConfig): CoreMetrics {
  const isVertical = config.direction === 'TB';
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const layerStats = new Map<number, { minCross: number; maxCross: number; sumCross: number; count: number }>();

  Object.values(layout.nodes).forEach((node) => {
    if (
      !node ||
      node.type === DUMMY_TYPE ||
      isTerminalNode(node) ||
      !isFiniteNumber(node.x) ||
      !isFiniteNumber(node.y)
    ) {
      return;
    }

    minX = Math.min(minX, node.x!);
    maxX = Math.max(maxX, node.x!);
    minY = Math.min(minY, node.y!);
    maxY = Math.max(maxY, node.y!);

    const layerIndex = Number.isFinite(node.layer) ? node.layer! : 0;
    const crossValue = isVertical ? node.x! : node.y!;
    const existing = layerStats.get(layerIndex) ?? {
      minCross: crossValue,
      maxCross: crossValue,
      sumCross: 0,
      count: 0,
    };
    existing.minCross = Math.min(existing.minCross, crossValue);
    existing.maxCross = Math.max(existing.maxCross, crossValue);
    existing.sumCross += crossValue;
    existing.count += 1;
    layerStats.set(layerIndex, existing);
  });

  const hasFiniteData =
    Number.isFinite(minX) &&
    Number.isFinite(maxX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxY) &&
    minX <= maxX &&
    minY <= maxY;

  if (!hasFiniteData) {
    return defaultCoreMetrics(config);
  }

  const layerSummaries: LayerSummary[] = Array.from(layerStats.entries())
    .map(([layer, stats]) => ({
      layer,
      minCross: stats.minCross,
      maxCross: stats.maxCross,
      meanCross: stats.sumCross / Math.max(stats.count, 1),
      nodeCount: stats.count,
    }))
    .sort((a, b) => a.layer - b.layer);

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    layerSummaries,
    hasFiniteData: true,
  };
}

function defaultCoreMetrics(config: LayoutConfig): CoreMetrics {
  const width = config.activityWidth ?? DEFAULT_NODE_WIDTH;
  const height = config.activityHeight ?? DEFAULT_NODE_HEIGHT;
  const minX = -width;
  const maxX = width;
  const minY = -height;
  const maxY = height;
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: 0,
    centerY: 0,
    layerSummaries: [],
    hasFiniteData: false,
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return value;
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
