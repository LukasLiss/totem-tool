import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  layoutOCDFGLongestTrace,
  type DfgNode,
  type DfgLink,
} from '../utils/GraphLayouter';
import { mapTypesToColors } from '../utils/objectColors';
import OcdfgEdge from './OcdfgEdge';
import OcdfgTerminalNode from './OcdfgTerminalNode';
import OcdfgDefaultNode from './OcdfgDefaultNode';
import OcdfgDebugLayerNode from './OcdfgDebugLayerNode';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { PlusIcon, MinusIcon, ScanIcon, LockIcon, UnlockIcon, BugIcon, ZapIcon, Sun } from 'lucide-react';

const DEFAULT_THICKNESS_MIN = 0.5;
const DEFAULT_THICKNESS_MAX = 2;
const DETAIL_FIT_PADDING = 0.12;
type LayoutDirection = 'TB' | 'LR';

const VARIANT_PRESETS = {
  full: {
    nodeWidth: 180,
    minHeightBase: 60,
    padding: 64,
    terminalSize: 80,
    nodePadding: 14,
    fontSize: 16,
  },
  canvas: {
    nodeWidth: 180,
    minHeightBase: 60,
    padding: 48,
    terminalSize: 80,
    nodePadding: 14,
    fontSize: 16,
  },
  detail: {
    nodeWidth: 110,
    minHeightBase: 44,
    padding: 20,
    terminalSize: 40,
    nodePadding: 8,
    fontSize: 12,
  },
} as const;

export type TraceVariant = {
  trace: string[];  // List of activity names in order
  count: number;    // Number of object instances with this trace
  objects: string[]; // Object IDs that followed this trace
};

// Trace variants per object type
export type TraceVariantsPerType = Record<string, {
  variants: TraceVariant[];
  total_objects: number;
}>;


export type OcdfgGraph = {
  nodes: DfgNode[];
  links: DfgLink[];
  trace_variants?: TraceVariantsPerType;
};

interface DfgData {
  dfg: OcdfgGraph;
}

interface OCDFGVisualizerProps {
  height?: string | number;
  data?: OcdfgGraph;
  fileId?: number;
  variant?: 'full' | 'canvas' | 'detail';
  layoutDirection?: 'TB' | 'LR';
  instanceId?: string;
  typeColorOverrides?: Record<string, string>;
  onSizeChange?: (size: { width: number; height: number }) => void;
  showControls?: boolean;
  initialInteractionLocked?: boolean;
}

function resolveHeightValue(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function coerceNumeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function measureGraphSize(
  renderNodes: Node[],
  renderEdges: Edge[],
  padding: number,
  fallbackWidth: number,
  fallbackHeight: number,
) {
  const visible = renderNodes
    .map((node) => {
      // XYFlow keeps measured sizes on runtime nodes; fall back to declared sizes otherwise.
      const positionSource = (node as any).positionAbsolute ?? node.position;
      const x = coerceNumeric(positionSource?.x);
      const y = coerceNumeric(positionSource?.y);
      return {
        node,
        x,
        y,
      };
    })
    .filter((entry) =>
      entry.node.hidden !== true && Number.isFinite(entry.x) && Number.isFinite(entry.y),
    );

  if (visible.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  visible.forEach(({ node, x, y }) => {
    const style = node.style as {
      width?: unknown;
      height?: unknown;
      minWidth?: unknown;
      minHeight?: unknown;
    } | undefined;
    const measuredWidth = coerceNumeric((node as any).measured?.width);
    const measuredHeight = coerceNumeric((node as any).measured?.height);
    const rawWidth =
      measuredWidth ??
      coerceNumeric(node.width) ??
      coerceNumeric(style?.width) ??
      coerceNumeric(style?.minWidth) ??
      fallbackWidth;
    const rawHeight =
      measuredHeight ??
      coerceNumeric(node.height) ??
      coerceNumeric(style?.height) ??
      coerceNumeric(style?.minHeight) ??
      fallbackHeight;
    const width = Math.max(1, rawWidth);
    const height = Math.max(1, rawHeight);

    minX = Math.min(minX, x ?? 0);
    minY = Math.min(minY, y ?? 0);
    maxX = Math.max(maxX, (x ?? 0) + width);
    maxY = Math.max(maxY, (y ?? 0) + height);
  });

  // Incorporate edge polylines so self-loops or long bends are accounted for.
  renderEdges.forEach((edge) => {
    const data = edge.data as { polyline?: Array<{ x?: number; y?: number }>; arrowPath?: string } | undefined;
    const polyline = Array.isArray(data?.polyline) ? data!.polyline : [];
    polyline.forEach((pt) => {
      const px = coerceNumeric(pt?.x);
      const py = coerceNumeric(pt?.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    });
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const paddedWidth = Math.ceil(maxX - minX + padding * 2);
  const paddedHeight = Math.ceil(maxY - minY + padding * 2);

  return {
    width: Math.max(fallbackWidth + padding * 2, paddedWidth),
    height: Math.max(fallbackHeight + padding * 2, paddedHeight),
  };
}

function transformLayoutDirection(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection,
): { nodes: Node[]; edges: Edge[] } {
  if (direction !== 'LR') {
    return { nodes, edges };
  }

  const positions = nodes
    .map((node) => {
      const x = coerceNumeric(node.position?.x) ?? 0;
      const y = coerceNumeric(node.position?.y) ?? 0;
      return { x, y };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const minX = positions.length > 0 ? Math.min(...positions.map((p) => p.x)) : 0;
  const minY = positions.length > 0 ? Math.min(...positions.map((p) => p.y)) : 0;

  const swapPoint = (point?: { x?: number; y?: number }) => {
    const x = coerceNumeric(point?.x) ?? 0;
    const y = coerceNumeric(point?.y) ?? 0;
    return {
      x: y - minY,
      y: x - minX,
    };
  };

  const swapVector = (vector?: { x?: number; y?: number }) => {
    const x = coerceNumeric(vector?.x) ?? 0;
    const y = coerceNumeric(vector?.y) ?? 0;
    return { x: y, y: x };
  };

  const transformedNodes = nodes.map((node) => {
    const pos = swapPoint(node.position ?? { x: 0, y: 0 });
    return {
      ...node,
      position: pos,
    };
  });

  const transformedEdges = edges.map((edge) => {
    const data = edge.data as {
      polyline?: Array<{ x: number; y: number }>;
      sourceAnchorOffset?: { x?: number; y?: number };
      targetAnchorOffset?: { x?: number; y?: number };
    } | undefined;
    const swappedPolyline = data?.polyline?.map((pt) => swapPoint(pt));
    const swappedSourceOffset = data?.sourceAnchorOffset
      ? swapVector(data.sourceAnchorOffset)
      : data?.sourceAnchorOffset;
    const swappedTargetOffset = data?.targetAnchorOffset
      ? swapVector(data.targetAnchorOffset)
      : data?.targetAnchorOffset;
    const nextData =
      swappedPolyline || swappedSourceOffset || swappedTargetOffset
        ? {
          ...data,
          polyline: swappedPolyline ?? data?.polyline,
          sourceAnchorOffset: swappedSourceOffset ?? data?.sourceAnchorOffset,
          targetAnchorOffset: swappedTargetOffset ?? data?.targetAnchorOffset,
        }
        : data;

    return nextData ? { ...edge, data: nextData } : edge;
  });

  return { nodes: transformedNodes, edges: transformedEdges };
}

function OCDFGVisualizer({
  height = 'calc(100vh - 50px)',
  data,
  fileId,
  variant = 'full',
  layoutDirection = 'TB',
  instanceId,
  typeColorOverrides,
  onSizeChange,
  showControls = true,
  initialInteractionLocked = true,
}: OCDFGVisualizerProps) {
  console.log('[OCDFGVisualizer] Longest Trace Mode - Component mounted!');

  const generatedInstanceId = useId();
  const reactFlowId = instanceId ?? generatedInstanceId;

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const [typeVisibility, setTypeVisibility] = useState<Record<string, boolean>>({});
  const [typeAvailability, setTypeAvailability] = useState<Record<string, boolean>>({});
  const [typeTraceLimit, setTypeTraceLimit] = useState<Record<string, number>>({});
  const [typeTraceMax, setTypeTraceMax] = useState<Record<string, number>>({});
  const [baseNodes, setBaseNodes] = useState<Node[]>([]);
  const [baseEdges, setBaseEdges] = useState<Edge[]>([]);
  const [dfgData, setDfgData] = useState<{ nodes: DfgNode[]; links: DfgLink[]; trace_variants?: TraceVariantsPerType } | null>(null);
  const [rawNodes, setRawNodes] = useState<Node[]>([]);
  const [rawEdges, setRawEdges] = useState<Edge[]>([]);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(initialInteractionLocked ?? true);
  const [autoInteractionLocked, setAutoInteractionLocked] = useState(true);
  const [showDebugOverlays, setShowDebugOverlays] = useState(false);
  const [animateEdges, setAnimateEdges] = useState(false);
  const [dimTerminalEdges, setDimTerminalEdges] = useState(false);
  const [measuredGraphSize, setMeasuredGraphSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const layoutActiveTypesRef = useRef<string[] | null>(null);
  const initialAvailabilityRef = useRef<Record<string, boolean> | null>(null);
  const layoutTraceLimitRef = useRef<string | null>(null);
  const typeTraceLimitCacheRef = useRef<Record<string, number>>({});
  const resolvedVariant = variant ?? 'full';
  const variantPreset = VARIANT_PRESETS[resolvedVariant] ?? VARIANT_PRESETS.full;
  const autoFitView = true;
  const paddingForSize = variantPreset.padding;
  const fallbackNodeWidth = variantPreset.nodeWidth;
  const fallbackNodeHeight = Math.max(variantPreset.minHeightBase, variantPreset.nodeWidth * 0.36);
  const nodePadding = variantPreset.nodePadding;
  const fontSize = variantPreset.fontSize;
  const terminalSize = variantPreset.terminalSize;
  const hideChrome = resolvedVariant !== 'full' || showControls === false;
  const lastReportedSizeRef = useRef<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow({ id: reactFlowId } as any);
  const { fitView } = reactFlow;
  // Layout reserve for legend on the left
  const LEGEND_WIDTH = 300;
  const LEGEND_MARGIN = 24;
  const LEGEND_BUFFER = 120;
  const LEGEND_TOTAL = LEGEND_WIDTH + LEGEND_MARGIN * 2 + LEGEND_BUFFER; // total space to keep free on the left
  const fitViewOptions = useMemo(() => {
    if (resolvedVariant === 'detail' || hideChrome) {
      return { padding: DETAIL_FIT_PADDING, offset: { x: 0, y: 0 } };
    }
    const leftOffset = LEGEND_TOTAL * 0.7;
    return { padding: 0.15, offset: { x: leftOffset, y: 0 } };
  }, [resolvedVariant, hideChrome, LEGEND_TOTAL]);
  const fitViewWithOffset = useCallback(() => fitView(fitViewOptions as any), [fitView, fitViewOptions]);
  const edgeTypes = useMemo(() => ({ ocdfg: OcdfgEdge as any }), []);
  const nodeTypes = useMemo(
    () => ({
      ocdfgStart: OcdfgTerminalNode as any,
      ocdfgEnd: OcdfgTerminalNode as any,
      ocdfgDefault: OcdfgDefaultNode as any,
      debugLayer: OcdfgDebugLayerNode as any,
    }),
    [],
  );

  const onNodesChange = useCallback((c: any) => setNodes((nds) => applyNodeChanges(c, nds)), []);
  const onEdgesChange = useCallback((c: any) => setEdges((eds) => applyEdgeChanges(c, eds)), []);

  const shallowBoolRecordEqual = (a: Record<string, boolean>, b: Record<string, boolean>) => {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => Boolean(a[k]) === Boolean(b[k]));
  };

  const resolveOwnerTypes = (entry?: { owners?: string[]; ownerTypes?: string[] }) => {
    const values = entry?.ownerTypes && entry.ownerTypes.length > 0
      ? entry.ownerTypes
      : entry?.owners ?? [];
    return values.filter((t): t is string => typeof t === 'string' && t.length > 0);
  };

  const resolveOwnerPairs = (entry?: { owners?: string[]; ownerTypes?: string[] }) => {
    const owners = entry?.owners ?? [];
    const ownerTypes = entry?.ownerTypes ?? [];
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

  function computeTypeAvailability(layoutNodes: Node[], layoutEdges: Edge[], allTypes: string[]) {
    const presence = Object.fromEntries(allTypes.map(t => [t, false])) as Record<string, boolean>;
    const visibleNodeIds = new Set(
      layoutNodes.filter(n => n.hidden !== true).map(n => n.id),
    );

    layoutEdges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
        return;
      }
      const ownerTypes = resolveOwnerTypes(
        edge.data as { owners?: string[]; ownerTypes?: string[] } | undefined,
      );
      ownerTypes.forEach((t) => {
        if (t in presence) {
          presence[t] = true;
        }
      });
    });

    return presence;
  }

  const stripDebugNodes = useCallback((nodeList: Node[]) => {
    return nodeList.filter((node) => {
      const id = typeof node.id === 'string' ? node.id : '';
      const type = typeof node.type === 'string' ? node.type : '';
      const data = (node.data as { isBuffer?: boolean; isDummy?: boolean } | undefined) ?? {};
      if (id.startsWith('debug-')) return false;
      if (type.startsWith('debug')) return false;
      if (data.isBuffer || data.isDummy) return false;
      return true;
    });
  }, []);

  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  const addLegendSpacer = useCallback((nodesIn: Node[]): Node[] => {
    if (hideChrome || Object.keys(typeColors).length === 0) return nodesIn;
    if (nodesIn.some(n => n.id === 'legend-spacer')) return nodesIn;
    const baseY = nodesIn.length > 0
      ? Math.min(...nodesIn.map(n => n.position?.y ?? 0)) - 40
      : -40;
    const spacer: Node = {
      id: 'legend-spacer',
      position: { x: -LEGEND_TOTAL, y: baseY },
      width: LEGEND_TOTAL,
      height: 10,
      data: {},
      selectable: false,
      draggable: false,
      type: 'ocdfgDefault',
      style: {
        opacity: 0,
        pointerEvents: 'none',
      },
    };
    return [...nodesIn, spacer];
  }, [hideChrome, typeColors, LEGEND_TOTAL]);

  const shiftForLegend = useCallback(
    (nodesIn: Node[], edgesIn: Edge[]) => {
      // Only shift when the left legend is visible.
      if (hideChrome || Object.keys(typeColors).length === 0) {
        return { nodes: nodesIn, edges: edgesIn };
      }
      // Apply a fixed positive shift so the graph always starts to the right of the legend.
      const shift = LEGEND_TOTAL + 16; // include outer margin

      const shiftedNodes = nodesIn.map(n => n.position
        ? { ...n, position: { ...n.position, x: n.position.x + shift } }
        : n);
      const shiftedEdges = edgesIn.map(e => {
        const data = e.data as { polyline?: Array<{ x?: number; y?: number }> } | undefined;
        const polyline = Array.isArray(data?.polyline)
          ? data!.polyline.map(p => ({ ...p, x: (p?.x ?? 0) + shift }))
          : undefined;
        return polyline
          ? { ...e, data: { ...(e.data ?? {}), polyline } }
          : e;
      });
      return { nodes: shiftedNodes, edges: shiftedEdges };
    },
    [hideChrome, typeColors],
  );

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const reportGraphSize = useCallback(
    (renderNodes?: Node[], renderEdges?: Edge[]) => {
      const nodesToMeasure =
        (renderNodes && renderNodes.length > 0 && renderNodes) ||
        nodesRef.current;
      const edgesToMeasure =
        (renderEdges && renderEdges.length > 0 && renderEdges) ||
        edgesRef.current;

      const measured = measureGraphSize(
        nodesToMeasure,
        edgesToMeasure ?? [],
        paddingForSize,
        fallbackNodeWidth,
        fallbackNodeHeight,
      );
      if (!measured) return;
      const previous = lastReportedSizeRef.current;
      if (previous && previous.width === measured.width && previous.height === measured.height) {
        return;
      }
      lastReportedSizeRef.current = measured;
      setMeasuredGraphSize(measured);
      if (onSizeChange) {
        onSizeChange(measured);
      }
    },
    [fallbackNodeHeight, fallbackNodeWidth, onSizeChange, paddingForSize],
  );

  const updateAutoInteractionLock = useCallback(() => {
    if (resolvedVariant !== 'detail') {
      setAutoInteractionLocked(false);
      return;
    }
    if (!measuredGraphSize || containerSize.width <= 0 || containerSize.height <= 0) {
      setAutoInteractionLocked(false);
      return;
    }
    const viewport = reactFlow.getViewport?.();
    const zoom = viewport?.zoom ?? 1;
    const fitsWidth = measuredGraphSize.width * zoom <= containerSize.width + 1;
    const fitsHeight = measuredGraphSize.height * zoom <= containerSize.height + 1;
    const shouldLock = fitsWidth && fitsHeight;
    setAutoInteractionLocked((prev) => (prev === shouldLock ? prev : shouldLock));
  }, [containerSize, measuredGraphSize, reactFlow, resolvedVariant]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const width = Math.max(0, container.clientWidth);
      const height = Math.max(0, container.clientHeight);
      setContainerSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    updateAutoInteractionLock();
  }, [updateAutoInteractionLock]);

  useEffect(() => {
    if (!autoFitView) return;
    if (!measuredGraphSize) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    if (nodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      fitView(fitViewOptions as any);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    resolvedVariant,
    measuredGraphSize,
    containerSize.width,
    containerSize.height,
    nodes.length,
    fitView,
    fitViewOptions,
    autoFitView,
  ]);

  useEffect(() => {
    if (data) {
      setDfgData({
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        links: Array.isArray(data.links) ? data.links : [],
        trace_variants: data.trace_variants,
      });
      return;
    }

    let cancelled = false;
    const url = fileId
      ? `http://127.0.0.1:8000/api/ocdfg/?file_id=${fileId}`
      : 'http://127.0.0.1:8000/api/ocdfg/';

    fetch(url)
      .then((response) => response.json())
      .then((payload: DfgData) => {
        if (cancelled) return;
        const graph = payload?.dfg;
        if (graph) {
          setDfgData({
            nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
            links: Array.isArray(graph.links) ? graph.links : [],
          });
        } else {
          setDfgData({ nodes: [], links: [] });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[OCDFGVisualizer] Failed to load OCDFG data', err);
          setDfgData({ nodes: [], links: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data, fileId]);

  useEffect(() => {
    if (!dfgData) {
      lastReportedSizeRef.current = null;
      setMeasuredGraphSize(null);
      setAutoInteractionLocked(false);
      setRawNodes([]);
      setRawEdges([]);
      setBaseNodes([]);
      setBaseEdges([]);
      setTypeColors({});
      setTypeAvailability({});
      setTypeVisibility({});
      setTypeTraceLimit({});
      setTypeTraceMax({});
      typeTraceLimitCacheRef.current = {};
      layoutActiveTypesRef.current = null;
      layoutTraceLimitRef.current = null;
      initialAvailabilityRef.current = null;
      return;
    }

    lastReportedSizeRef.current = null;
    const dfgNodes = Array.isArray(dfgData.nodes) ? dfgData.nodes : [];
    const dfgLinks = Array.isArray(dfgData.links) ? dfgData.links : [];

    const allTypes = Array.from(new Set(dfgNodes.flatMap((node) => node.types ?? [])));
    const ownersByType = new Map<string, Set<string>>();
    dfgLinks.forEach((link) => {
      resolveOwnerPairs(link).forEach(({ owner, type }) => {
        if (!ownersByType.has(type)) ownersByType.set(type, new Set());
        ownersByType.get(type)!.add(owner);
      });
    });

    const initialTraceMax = Object.fromEntries(
      allTypes.map((type) => [type, ownersByType.get(type)?.size ?? 0]),
    );
    setTypeTraceMax(initialTraceMax);
    setTypeTraceLimit(initialTraceMax);
    const colors = mapTypesToColors(allTypes, typeColorOverrides);
    setTypeColors(colors);
    const initialAvailability = Object.fromEntries(allTypes.map((type) => [type, true]));
    setTypeAvailability(initialAvailability);
    const initialVisibility = Object.fromEntries(allTypes.map((type) => [type, true]));
    setTypeVisibility(initialVisibility);
    typeTraceLimitCacheRef.current = {};
    layoutActiveTypesRef.current = null;
    layoutTraceLimitRef.current = null;
    initialAvailabilityRef.current = null;

    const groupCounts: Record<string, number> = {};
    dfgLinks.forEach((link) => {
      const key = `${link.source}->${link.target}`;
      groupCounts[key] = (groupCounts[key] ?? 0) + 1;
    });
    const groupIndex: Record<string, number> = {};
    const incomingCounts: Record<string, number> = {};
    const outgoingCounts: Record<string, number> = {};
    dfgLinks.forEach((link) => {
      incomingCounts[link.target] = (incomingCounts[link.target] ?? 0) + 1;
      outgoingCounts[link.source] = (outgoingCounts[link.source] ?? 0) + 1;
    });

    const resolveLinkFrequency = (link: DfgLink) => {
      if (typeof link.weight === 'number' && Number.isFinite(link.weight)) {
        return Math.max(0, link.weight);
      }
      if (link.weights && typeof link.weights === 'object') {
        const total = Object.values(link.weights).reduce((sum: number, value) => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return sum + value;
          }
          return sum;
        }, 0);
        if (total > 0) {
          return total;
        }
      }
      if (Array.isArray(link.owners) && link.owners.length > 0) {
        return link.owners.length;
      }
      return 1;
    };

    const frequencies = dfgLinks.map(resolveLinkFrequency);
    const minFrequency = frequencies.length > 0 ? Math.min(...frequencies) : 1;
    const maxFrequency = frequencies.length > 0 ? Math.max(...frequencies) : minFrequency;
    const frequencySpan = Math.max(maxFrequency - minFrequency, 0);
    const normalizedValues = frequencies.map((frequency) => {
      if (!Number.isFinite(frequency) || frequencySpan < 1e-9) {
        return 0;
      }
      return (frequency - minFrequency) / frequencySpan;
    });
    const thicknessFactors = normalizedValues.map((normalized) => {
      const factor =
        DEFAULT_THICKNESS_MIN +
        Math.min(1, Math.max(0, normalized)) * (DEFAULT_THICKNESS_MAX - DEFAULT_THICKNESS_MIN);
      return Math.min(DEFAULT_THICKNESS_MAX, Math.max(DEFAULT_THICKNESS_MIN, factor));
    });

    const nodeVariantMap: Record<string, 'start' | 'end' | 'center' | undefined> = {};
    const typeIndicatorSize = resolvedVariant === 'detail' ? 10 : 14;
    const typeIndicatorThickness = resolvedVariant === 'detail' ? 1.5 : 2;

    // Create standard React Flow nodes
    const initialNodes: Node[] = dfgNodes.map((node) => {
      const isStart = (incomingCounts[node.id] ?? 0) === 0;
      const isEnd = !isStart && (outgoingCounts[node.id] ?? 0) === 0;
      const fillColor = (node.types?.[0] && colors[node.types[0]]) || '#2563EB';
      const variant: 'start' | 'end' | 'center' = isStart ? 'start' : isEnd ? 'end' : 'center';
      const cleanLabel = (node.label || node.id || '').trim();
      const approxLines =
        cleanLabel.length === 0 ? 1 : Math.max(1, Math.ceil(cleanLabel.length / 22));
      const baseHeight = Math.max(variantPreset.minHeightBase, approxLines * 20);
      const minHeight = baseHeight + 0;
      const sharedData = {
        label: node.label || node.id,
        types: node.types ?? [],
        colors,
        fillColor,
        nodeVariant: variant,
        isStart,
        layoutDirection,
        typeIndicatorSize,
        typeIndicatorThickness,
      };
      const terminalLabel =
        node.types && node.types.length > 0
          ? node.types[0]
          : cleanLabel.replace(/\s+(start|end)$/i, '').trim() || node.id;

      if (isStart) {
        nodeVariantMap[node.id] = 'start';
        return {
          id: node.id,
          type: 'ocdfgStart' as const,
          data: {
            ...sharedData,
            label: terminalLabel,
            sizePreset: resolvedVariant === 'detail' ? 'terminal-min' : 'terminal',
          },
          width: terminalSize,
          height: terminalSize,
          style: {
            width: terminalSize,
            height: terminalSize,
            padding: 0,
            border: 'none',
            boxShadow: 'none',
            background: 'transparent',
          },
          position: { x: 0, y: 0 },
        };
      }

      if (isEnd) {
        nodeVariantMap[node.id] = 'end';
        return {
          id: node.id,
          type: 'ocdfgEnd' as const,
          data: {
            ...sharedData,
            label: terminalLabel,
            sizePreset: resolvedVariant === 'detail' ? 'terminal-min' : 'terminal',
          },
          width: terminalSize,
          height: terminalSize,
          style: {
            width: terminalSize,
            height: terminalSize,
            padding: 0,
            border: 'none',
            boxShadow: 'none',
            background: 'transparent',
          },
          position: { x: 0, y: 0 },
        };
      }

      nodeVariantMap[node.id] = 'center';
      return {
        id: node.id,
        type: 'ocdfgDefault' as const,
        data: sharedData,
        width: fallbackNodeWidth,
        height: minHeight,
        position: { x: 0, y: 0 },
        style: {
          background: '#FFFFFF',
          color: '#000000',
          border: '1px solid #000000',
          borderRadius: 12,
          padding: nodePadding,
          minHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-primary, Inter, sans-serif)',
          fontWeight: 500,
          fontSize,
          letterSpacing: '-0.01em',
          boxShadow: 'none',
          minWidth: fallbackNodeWidth,
        },
      };
    });

    initialNodes.forEach((node) => {
      const variant = (node.data as { nodeVariant?: 'start' | 'end' | 'center' } | undefined)?.nodeVariant;
      if (variant === 'start' || variant === 'end' || variant === 'center') {
        nodeVariantMap[node.id] = variant;
      }
    });

    const initialEdges: Edge[] = dfgLinks.map((link, index) => {
      const key = `${link.source}->${link.target}`;
      const currentIndex = groupIndex[key] ?? 0;
      groupIndex[key] = currentIndex + 1;
      return {
        id: `e${index}-${link.source}-${link.target}`,
        source: link.source,
        target: link.target,
        type: 'ocdfg',
        animated: true,
        data: {
          owners: link.owners ?? [],
          ownerTypes: link.ownerTypes ?? [],
          colors,
          parallelIndex: currentIndex,
          parallelCount: groupCounts[key],
          sourceVariant: nodeVariantMap[link.source],
          targetVariant: nodeVariantMap[link.target],
          frequency: frequencies[index],
          frequencyNormalized: normalizedValues[index],
          thicknessFactor: thicknessFactors[index],
        },
      } as Edge;
    });

    setRawNodes(initialNodes);
    setRawEdges(initialEdges);
  }, [dfgData, variantPreset, fallbackNodeWidth, nodePadding, fontSize, terminalSize, typeColorOverrides]);

  useEffect(() => {
    if (!dfgData) return;
    if (rawNodes.length === 0 || rawEdges.length === 0) return;

    const activeTypes = Object.entries(typeVisibility)
      .filter(([, visible]) => visible !== false)
      .map(([type]) => type)
      .sort();

    const requestedTypes = activeTypes;
    const traceLimitKey = JSON.stringify(typeTraceLimit);

    layoutActiveTypesRef.current = activeTypes;
    layoutTraceLimitRef.current = traceLimitKey;

    if (activeTypes.length === 0) {
      setBaseNodes([]);
      setBaseEdges([]);
      return;
    }

    layoutOCDFGLongestTrace({
      renderNodes: rawNodes,
      renderEdges: rawEdges,
      dfgNodes: dfgData.nodes,
      dfgLinks: dfgData.links,
      typeTraceLimit,
      activeTypes,
      direction: layoutDirection,
      layoutKey: reactFlowId,
      includeDebugOverlays: showDebugOverlays,
      ignoreTypesWithoutTraces: resolvedVariant === 'detail',
      backendTraceVariants: dfgData.trace_variants,
    }).then(({ nodes: layoutedNodes, edges: layoutedEdges, traceCounts }) => {
      if (traceCounts) {
        const prevMaxSnapshot = typeTraceMax;
        setTypeTraceMax((prev) => {
          const next: Record<string, number> = { ...prev };
          let changed = false;
          Object.entries(traceCounts).forEach(([type, count]) => {
            if (next[type] !== count) {
              next[type] = count;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
        setTypeTraceLimit((prev) => {
          const next: Record<string, number> = { ...prev };
          let changed = false;
          Object.entries(traceCounts).forEach(([type, count]) => {
            const prevMax = prevMaxSnapshot[type];
            const current = prev[type];
            const shouldAutoExpand = current === undefined || current === prevMax;
            const desired = shouldAutoExpand ? count : Math.min(Math.max(0, current ?? count), count);
            if (desired !== current) {
              next[type] = desired;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }

      const cleanedNodes = (resolvedVariant === 'detail' || !showDebugOverlays)
        ? stripDebugNodes(layoutedNodes)
        : layoutedNodes;
      const { nodes: directedNodes, edges: directedEdges } = transformLayoutDirection(
        cleanedNodes,
        layoutedEdges,
        layoutDirection,
      );
      const shifted = shiftForLegend(directedNodes, directedEdges);
      const spacedNodes = addLegendSpacer(shifted.nodes);
      setBaseNodes(spacedNodes);
      setBaseEdges(shifted.edges);
      if (directedNodes.length > 0) {
        const availability = computeTypeAvailability(
          directedNodes,
          directedEdges,
          Object.keys(typeColors),
        );
        if (!initialAvailabilityRef.current) {
          initialAvailabilityRef.current = availability;
        }
        const mergedAvailability = initialAvailabilityRef.current
          ? Object.fromEntries(
            Object.keys(availability).map((type) => [
              type,
              availability[type] || initialAvailabilityRef.current?.[type] === true,
            ]),
          )
          : availability;
        initialAvailabilityRef.current = mergedAvailability;
        setTypeAvailability(prev => shallowBoolRecordEqual(prev, mergedAvailability) ? prev : mergedAvailability);
      }
      if (autoFitView) {
        window.requestAnimationFrame(() => fitViewWithOffset());
      }
    }).catch(console.error);
  }, [
    typeVisibility,
    typeTraceLimit,
    rawNodes,
    rawEdges,
    dfgData,
    typeColors,
    fitViewWithOffset,
    resolvedVariant,
    stripDebugNodes,
    layoutDirection,
    transformLayoutDirection,
    reactFlowId,
    autoFitView,
    reportGraphSize,
    showDebugOverlays,
    shiftForLegend,
  ]);

  useEffect(() => {
    if (baseNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      setMeasuredGraphSize(null);
      return;
    }

    const nodesForVisibility = showDebugOverlays ? baseNodes : stripDebugNodes(baseNodes);

    const availability = computeTypeAvailability(nodesForVisibility, baseEdges, Object.keys(typeColors));
    if (!initialAvailabilityRef.current) {
      initialAvailabilityRef.current = availability;
    }
    const mergedAvailability = initialAvailabilityRef.current
      ? Object.fromEntries(
        Object.keys(availability).map((type) => [
          type,
          availability[type] || initialAvailabilityRef.current?.[type] === true,
        ]),
      )
      : availability;
    initialAvailabilityRef.current = mergedAvailability;
    setTypeAvailability(prev => shallowBoolRecordEqual(prev, mergedAvailability) ? prev : mergedAvailability);

    const resolvedNodes = nodesForVisibility.map((node) => {
      const nodeTypes = (node.data as { types?: string[] } | undefined)?.types ?? [];
      const baseHidden = node.hidden === true;
      const hasVisibleType = nodeTypes.length === 0
        ? true
        : nodeTypes.some((t) => typeVisibility[t] !== false);

      if (!baseHidden && hasVisibleType) {
        return { ...node, hidden: false };
      }
      return { ...node, hidden: true };
    });

    const visibleNodeIds = new Set(resolvedNodes.filter(n => !n.hidden).map(n => n.id));
    const filteredEdges = baseEdges.filter(edge => {
      const ownerTypes = resolveOwnerTypes(
        edge.data as { owners?: string[]; ownerTypes?: string[] } | undefined,
      );
      const blockedByType = ownerTypes.some(t => typeVisibility[t] === false);
      if (blockedByType) return false;
      return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
    }).map(edge => ({
      ...edge,
      animated: animateEdges,
      data: {
        ...(edge.data ?? {}),
        overlayDebug: showDebugOverlays
          ? (edge.data as Record<string, unknown>)?.overlayDebug ?? false
          : false,
        dimmed:
          dimTerminalEdges
          && (
            (edge.data as { sourceVariant?: string } | undefined)?.sourceVariant === 'start'
            || (edge.data as { sourceVariant?: string } | undefined)?.sourceVariant === 'end'
            || (edge.data as { targetVariant?: string } | undefined)?.targetVariant === 'start'
            || (edge.data as { targetVariant?: string } | undefined)?.targetVariant === 'end'
          ),
      },
    }));

    setNodes(resolvedNodes);
    setEdges(filteredEdges);
    reportGraphSize(resolvedNodes, filteredEdges);
  }, [baseNodes, baseEdges, typeVisibility, typeColors, reportGraphSize, showDebugOverlays, animateEdges, dimTerminalEdges, stripDebugNodes]);

  useEffect(() => {
    if (!typeAvailability) return;
    setTypeVisibility(prev => {
      const next: Record<string, boolean> = { ...prev };
      let changed = false;
      Object.entries(typeAvailability).forEach(([t, available]) => {
        if (available === false) {
          if (next[t] !== false) {
            next[t] = false;
            changed = true;
          }
        } else if (available === true && next[t] === undefined) {
          next[t] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [typeAvailability]);

  const handleTypeToggle = (type: string, checked: boolean) => {
    if (typeAvailability[type] !== true && checked) {
      return;
    }

    const max = typeTraceMax[type] ?? 0;
    const currentLimit = typeTraceLimit[type] ?? max;

    if (!checked) {
      typeTraceLimitCacheRef.current[type] = currentLimit;
      setTypeTraceLimit(prev => ({ ...prev, [type]: 0 }));
      setTypeVisibility(prev => ({ ...prev, [type]: false }));
      return;
    }

    const cached = typeTraceLimitCacheRef.current[type];
    const restoredBase = cached ?? currentLimit ?? max;
    const restored = Math.min(Math.max(0, restoredBase), max);
    setTypeVisibility(prev => ({ ...prev, [type]: true }));
    setTypeTraceLimit(prev => ({ ...prev, [type]: restored }));
  };

  const handleTraceLimitChange = (type: string, value: number) => {
    const max = typeTraceMax[type] ?? 0;
    const clamped = Math.min(Math.max(0, Math.round(value)), max);
    const prevLimit = typeTraceLimit[type] ?? max;

    if (clamped === 0) {
      typeTraceLimitCacheRef.current[type] = prevLimit;
      setTypeVisibility(prev => (prev[type] === false ? prev : { ...prev, [type]: false }));
    }

    if (clamped > 0) {
      setTypeVisibility(prev => ({ ...prev, [type]: true }));
    }

    setTypeTraceLimit(prev => ({ ...prev, [type]: clamped }));
  };

  useEffect(() => {
    if (Object.keys(typeTraceMax).length === 0) return;
    setTypeTraceLimit((prev) => {
      const next: Record<string, number> = { ...prev };
      let changed = false;
      Object.entries(typeTraceMax).forEach(([type, max]) => {
        const current = prev[type];
        const desired = current === undefined ? max : Math.min(Math.max(0, current), max);
        if (desired !== current) {
          next[type] = desired;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [typeTraceMax]);

  const interactionsDisabled = interactionLocked || autoInteractionLocked;

  return (
    <div
      ref={containerRef}
      style={{ height: resolveHeightValue(height), width: '100%', position: 'relative' }}
    >
      <ReactFlow
        id={reactFlowId}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveEnd={resolvedVariant === 'detail' ? updateAutoInteractionLock : undefined}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        fitView={autoFitView}
        fitViewOptions={fitViewOptions}
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={2.5}
        nodesDraggable={!interactionsDisabled}
        nodesConnectable={!interactionsDisabled}
        elementsSelectable={!interactionsDisabled}
        panOnDrag={!interactionsDisabled}
        panOnScroll={!interactionsDisabled}
        zoomOnPinch={!interactionsDisabled}
        zoomOnScroll={!interactionsDisabled}
        zoomOnDoubleClick={!interactionsDisabled}
      />

      {!hideChrome && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: 'calc(100% - 32px)',
          }}
        >
          <div
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 12,
              padding: '10px 14px',
              boxShadow: 'none',
              fontFamily: 'var(--font-primary, Inter, sans-serif)',
              minWidth: 240,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>
              Object-Centric DFG
            </div>
          </div>
          {Object.keys(typeColors).length > 0 && (
            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                padding: '12px 16px',
                boxShadow: '0 6px 16px rgba(15, 23, 42, 0.05)',
                fontFamily: 'var(--font-primary, Inter, sans-serif)',
                maxHeight: '50vh',
                overflowY: 'auto',
                minWidth: 240,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: legendCollapsed ? 0 : 8,
                  fontWeight: 600,
                  fontSize: 14,
                  color: '#0F172A',
                }}
              >
                <span>Longest Trace View</span>
                <button
                  type="button"
                  onClick={() => setLegendCollapsed((prev) => !prev)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#64748B',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {legendCollapsed ? 'Show' : 'Hide'}
                </button>
              </div>
              {!legendCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(typeColors).map(([type, color]) => {
                    const max = typeTraceMax[type] ?? 0;
                    const resolvedLimit = typeTraceLimit[type] ?? max;
                    const clampedLimit = Math.min(Math.max(0, resolvedLimit), max);
                    const isVisible = typeVisibility[type] !== false;
                    const sliderDisabled = typeAvailability[type] !== true || max <= 0;
                    const sliderValue = clampedLimit;

                    return (
                      <div
                        key={type}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          paddingBottom: 6,
                          borderBottom: '1px solid #E2E8F0',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              aria-hidden
                              style={{
                                display: 'inline-block',
                                width: 18,
                                height: 18,
                                borderRadius: '50%',
                                background: color,
                                border: '1px solid rgba(15, 23, 42, 0.12)',
                                boxShadow: '0 4px 8px rgba(15, 23, 42, 0.18)',
                              }}
                            />
                            <span style={{ fontSize: 13, color: '#475569', letterSpacing: '-0.01em' }}>{type}</span>
                          </div>
                          <Switch
                            checked={typeVisibility[type] !== false}
                            disabled={typeAvailability[type] !== true}
                            onCheckedChange={(checked) => handleTypeToggle(type, checked)}
                          />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            opacity: typeAvailability[type] ? (isVisible ? 1 : 0.7) : 0.5,
                          }}
                        >
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Slider
                              min={0}
                              max={max}
                              step={1}
                              value={[sliderValue]}
                              onValueChange={(values) => handleTraceLimitChange(type, values?.[0] ?? 0)}
                              disabled={sliderDisabled}
                            />
                            <span style={{ fontSize: 12, color: '#475569', minWidth: 72, textAlign: 'right' }}>
                              {sliderValue}/{max} traces
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 9999,
              padding: '6px 12px',
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
            }}
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => reactFlow.zoomIn?.()}
              className="rounded-full h-9 w-9"
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => reactFlow.zoomOut?.()}
              className="rounded-full h-9 w-9"
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fitViewWithOffset()}
              className="rounded-full h-9 w-9"
            >
              <ScanIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={interactionLocked ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setInteractionLocked((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={interactionLocked ? 'Unlock interactions' : 'Lock interactions'}
            >
              {interactionLocked ? <UnlockIcon className="h-4 w-4" /> : <LockIcon className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant={showDebugOverlays ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setShowDebugOverlays((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={showDebugOverlays ? 'Hide debug overlays' : 'Show debug overlays'}
            >
              <BugIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={animateEdges ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setAnimateEdges((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={animateEdges ? 'Disable edge animation' : 'Enable edge animation'}
            >
              <ZapIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={dimTerminalEdges ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setDimTerminalEdges((prev) => !prev)}
              className="rounded-full h-9 w-9"
              title={dimTerminalEdges ? 'Undim terminal edges' : 'Dim edges touching start/end'}
            >
              <Sun className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OCDFGVisualizer;
