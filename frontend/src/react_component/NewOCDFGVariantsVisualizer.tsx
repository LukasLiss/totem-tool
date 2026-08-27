import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import axios from 'axios';
import { useFilterVersion } from '@/store/filterStore';
import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { calculateNodeRanks, getLayoutedElements } from '../utils/NaiveOCDFGLayouting';
import { mapTypesToColors } from '../utils/objectColors';
import NewOcdfgEdge from './NewOcdfgEdge';
import OcdfgTerminalNode from './OcdfgTerminalNode';
import OcdfgDefaultNode from './OcdfgDefaultNode';
import OcdfgDebugLayerNode from './OcdfgDebugLayerNode';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { MetricTooltip } from './MetricTooltip';
import { PlusIcon, MinusIcon, ScanIcon, LockIcon, UnlockIcon, ZapIcon, Sun } from 'lucide-react';
import { GlobalFilterToggle } from '@/components/ui/GlobalFilterToggle';

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

export type DfgNode = {
  id: string;
  label: string;
  types?: string[];
  metrics?: { frequency?: number; avg_lead_time?: number | null } | null;
};

export type DfgLink = {
  source: string;
  target: string;
  key?: string;
  objtype?: string;
  weight?: number;
  variant_rank?: number;
  metrics?: { frequency?: number; avg_lead_time?: number | null } | null;
};

export type OcdfgGraph = {
  nodes: DfgNode[];
  links: DfgLink[];
};

interface DfgData {
  dfg: OcdfgGraph;
  /** Per-type total variant count — used to seed slider maxima. */
  variant_counts?: Record<string, number>;
}

interface NewOCDFGVariantsVisualizerProps {
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
  filterEnabled?: boolean;
  onToggleFilter?: () => void;
  showTitle?: boolean;
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



function extractElkPolyline(elkEdge: any): Array<{ x: number; y: number }> | undefined {
  if (!elkEdge.sections || elkEdge.sections.length === 0) return undefined;
  const section = elkEdge.sections[0];
  const points: Array<{ x: number; y: number }> = [];
  
  if (section.startPoint) {
    points.push({ x: section.startPoint.x, y: section.startPoint.y });
  }
  if (section.bendPoints) {
    section.bendPoints.forEach((p: any) => {
      points.push({ x: p.x, y: p.y });
    });
  }
  if (section.endPoint) {
    points.push({ x: section.endPoint.x, y: section.endPoint.y });
  }
  return points;
}

function NewOCDFGVariantsVisualizer({
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
  filterEnabled = false,
  onToggleFilter = () => {},
  showTitle = true,
}: NewOCDFGVariantsVisualizerProps) {
  console.log('[NewOCDFGVariantsVisualizer] ELK Layered MultiGraph Mode - Mounted!');

  const generatedInstanceId = useId();
  const reactFlowId = instanceId ?? generatedInstanceId;

  const filterVersion = useFilterVersion();
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const [typeAvailability, setTypeAvailability] = useState<Record<string, boolean>>({});
  const [typeVisibility, setTypeVisibility] = useState<Record<string, boolean>>({});

  const [dfgData, setDfgData] = useState<OcdfgGraph | null>(null);
  const [rawNodes, setRawNodes] = useState<Node[]>([]);
  const [rawEdges, setRawEdges] = useState<Edge[]>([]);
  const [baseNodes, setBaseNodes] = useState<Node[]>([]);
  const [baseEdges, setBaseEdges] = useState<Edge[]>([]);

  // Variant-rank slider state (client-side filtering — no backend refetch)
  const [traceMax, setTraceMax]   = useState<Record<string, number>>({});
  const [traceLimit, setTraceLimit] = useState<Record<string, number>>({});

  const [animateEdges, setAnimateEdges] = useState(false);
  const [dimTerminalEdges, setDimTerminalEdges] = useState(false);
  const [measuredGraphSize, setMeasuredGraphSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const initialAvailabilityRef = useRef<Record<string, boolean> | null>(null);
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
  // Stable refs so reportGraphSize can read current nodes/edges without
  // being listed as a dependency (which would create an infinite loop).
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  const reactFlow = useReactFlow();
  const { fitView } = reactFlow;

  const LEGEND_WIDTH = 300;
  const LEGEND_MARGIN = 24;
  const LEGEND_BUFFER = 120;
  const LEGEND_TOTAL = LEGEND_WIDTH + LEGEND_MARGIN * 2 + LEGEND_BUFFER;

  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [legendPosition, setLegendPosition] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const handleLegendPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: legendPosition.x,
      startY: legendPosition.y,
    };
  }, [legendPosition]);

  const handleLegendPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setLegendPosition({
      x: dragStartRef.current.startX + dx,
      y: dragStartRef.current.startY + dy,
    });
  }, []);

  const handleLegendPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
  }, []);

  const [interactionLocked, setInteractionLocked] = useState(initialInteractionLocked ?? true);
  const [autoInteractionLocked, setAutoInteractionLocked] = useState(true);

  const [tooltipState, setTooltipState] = useState<{ x: number, y: number, metrics: any, label?: string } | null>(null);

  const handleNodeMouseEnter = useCallback((event: React.MouseEvent, node: Node) => {
    const metrics = (node.data as any)?.metrics;
    if (metrics) {
      setTooltipState({
        x: event.clientX,
        y: event.clientY,
        metrics,
        label: (node.data as any)?.label
      });
    }
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setTooltipState(null);
  }, []);

  const handleNodeMouseMove = useCallback((event: React.MouseEvent) => {
    setTooltipState(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : null);
  }, []);

  const handleEdgeMouseEnter = useCallback((event: React.MouseEvent, edge: Edge) => {
    const metrics = (edge.data as any)?.metrics;
    if (metrics) {
      setTooltipState({
        x: event.clientX,
        y: event.clientY,
        metrics,
        label: 'Directly-Follows Arc'
      });
    }
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    setTooltipState(null);
  }, []);

  const handleEdgeMouseMove = useCallback((event: React.MouseEvent) => {
    setTooltipState(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : null);
  }, []);

  const fitViewOptions = useMemo(() => {
    if (resolvedVariant === 'detail' || hideChrome) {
      return { padding: DETAIL_FIT_PADDING, offset: { x: 0, y: 0 } };
    }
    const leftOffset = LEGEND_TOTAL * 0.7;
    return { padding: 0.15, offset: { x: leftOffset, y: 0 } };
  }, [resolvedVariant, hideChrome, LEGEND_TOTAL]);

  const fitViewWithOffset = useCallback(() => fitView(fitViewOptions as any), [fitView, fitViewOptions]);
  const edgeTypes = useMemo(() => ({ ocdfg: NewOcdfgEdge as any }), []);
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

  function computeTypeAvailability(layoutNodes: Node[], layoutEdges: Edge[], allTypes: string[]) {
    const presence = Object.fromEntries(allTypes.map(t => [t, false])) as Record<string, boolean>;
    const visibleNodeIds = new Set(
      layoutNodes.filter(n => n.hidden !== true).map(n => n.id),
    );

    layoutEdges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
        return;
      }
      const objtype = (edge.data as { objtype?: string } | undefined)?.objtype;
      if (objtype && objtype in presence) {
        presence[objtype] = true;
      }
    });

    return presence;
  }

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
      if (hideChrome || Object.keys(typeColors).length === 0) {
        return { nodes: nodesIn, edges: edgesIn };
      }
      const shift = LEGEND_TOTAL + 16;

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

  const reportGraphSize = useCallback(
    (renderNodes?: Node[], renderEdges?: Edge[]) => {
      // Use the passed args first; fall back to refs (not state) so this
      // callback does NOT need nodes/edges in its dependency array.
      const nodesToMeasure = renderNodes ?? nodesRef.current;
      const edgesToMeasure = renderEdges ?? edgesRef.current;

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
    // nodes and edges intentionally omitted ΓÇö we use refs to avoid an
    // infinite loop: setNodes ΓåÆ nodes changes ΓåÆ reportGraphSize recreated
    // ΓåÆ effect re-runs ΓåÆ setNodes again.
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
      setDfgData(data);
      return;
    }

    if (!fileId) {
      setDfgData({ nodes: [], links: [] });
      return;
    }

    let cancelled = false;
    const url = `http://localhost:8000/api/new-ocdfg/?file_id=${fileId}`;

    axios.get<DfgData>(url, { _skipGlobalFilter: !filterEnabled })
      .then(({ data: payload }) => {
        if (cancelled) return;
        const graph = payload?.dfg;
        if (graph) setDfgData(graph);
        else        setDfgData({ nodes: [], links: [] });

        // Seed slider maxima from variant_counts returned by the backend.
        // The backend now annotates every edge with variant_rank so the
        // frontend can filter entirely client-side — no re-fetch needed.
        const vc = payload?.variant_counts;
        if (vc) {
          setTraceMax(prev => {
            const next: Record<string, number> = { ...prev };
            Object.entries(vc).forEach(([t, count]) => {
              if (!(t in next)) next[t] = count;
            });
            return next;
          });
          setTraceLimit(prev => {
            const next: Record<string, number> = { ...prev };
            Object.entries(vc).forEach(([t, count]) => {
              if (!(t in next)) next[t] = count;
            });
            return next;
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[NewOCDFGVariantsVisualizer] Failed to load new OCDFG data', err);
          setDfgData({ nodes: [], links: [] });
        }
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fileId, filterEnabled, effectiveFilterVersion]);

  // Slider change: pure client-side — just update traceLimit state.
  // The layout effect has traceLimit in its dependency array so it will
  // re-run and filter rawEdges by variant_rank without any network request.
  const handleTraceLimitChange = useCallback(
    (otype: string, value: number) => {
      setTraceLimit(prev => ({ ...prev, [otype]: value }));
    },
    [],
  );

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
      initialAvailabilityRef.current = null;
      return;
    }

    lastReportedSizeRef.current = null;
    const dfgNodes = Array.isArray(dfgData.nodes) ? dfgData.nodes : [];
    const dfgLinks = Array.isArray(dfgData.links) ? dfgData.links : [];

    const allTypes = Array.from(new Set([
      ...dfgNodes.flatMap((node) => node.types ?? []),
      ...dfgLinks.map((link) => link.key ?? link.objtype).filter((t): t is string => typeof t === 'string')
    ]));

    const colors = mapTypesToColors(allTypes, typeColorOverrides);
    setTypeColors(colors);
    const initialAvailability = Object.fromEntries(allTypes.map((type) => [type, true]));
    setTypeAvailability(initialAvailability);
    const initialVisibility = Object.fromEntries(allTypes.map((type) => [type, true]));
    setTypeVisibility(initialVisibility);
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

    const frequencies = dfgLinks.map(l => l.weight ?? 1);
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
        metrics: node.metrics ?? null,
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
      const typeKey = link.key ?? link.objtype ?? 'default';

      return {
        id: `e${index}-${link.source}-${link.target}-${typeKey}`,
        source: link.source,
        target: link.target,
        type: 'ocdfg',
        animated: true,
        data: {
          objtype: typeKey,
          // variant_rank: 0 = start/end connector (always show)
          //               N = only show when slider >= N
          variant_rank: link.variant_rank ?? 0,
          colors,
          parallelIndex: currentIndex,
          parallelCount: groupCounts[key],
          sourceVariant: nodeVariantMap[link.source],
          targetVariant: nodeVariantMap[link.target],
          frequency: frequencies[index],
          frequencyNormalized: normalizedValues[index],
          thicknessFactor: thicknessFactors[index],
          metrics: link.metrics ?? (link.weight != null ? { frequency: link.weight, avg_lead_time: null } : null),
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

    if (activeTypes.length === 0) {
      setBaseNodes([]);
      setBaseEdges([]);
      return;
    }

    const filteredEdges = rawEdges.filter(edge => {
      const objtype = (edge.data as { objtype?: string } | undefined)?.objtype;
      // Visibility toggle
      if (objtype && typeVisibility[objtype] === false) return false;
      // Variant-rank client-side filter
      // variant_rank 0 = start/end connector edges — always visible
      const variantRank = (edge.data as { variant_rank?: number } | undefined)?.variant_rank ?? 0;
      if (variantRank === 0) return true;
      const limit = traceLimit[objtype ?? ''] ?? (traceMax[objtype ?? ''] ?? Infinity);
      return variantRank <= limit;
    });

    // Find which nodes are actually connected to visible edges
    const connectedNodeIds = new Set<string>();
    filteredEdges.forEach(e => {
      connectedNodeIds.add(e.source);
      connectedNodeIds.add(e.target);
    });

    const filteredNodes = rawNodes.filter(node => {
      const nodeTypes = (node.data as { types?: string[] } | undefined)?.types ?? [];
      const visibleByType = nodeTypes.length === 0 ? true : nodeTypes.some(t => typeVisibility[t] !== false);
      return visibleByType && connectedNodeIds.has(node.id);
    });


    const naiveNodes = dfgData.nodes;
    const naiveLinks = dfgData.links.map(l => ({
      source: l.source,
      target: l.target,
      weight: l.weight,
      objtypes: [l.key ?? l.objtype],
    }));

    const ranks = calculateNodeRanks(naiveNodes, naiveLinks);

    getLayoutedElements(filteredNodes, filteredEdges, ranks, layoutDirection).then(({ nodes: layoutedNodes, edges: layoutedEdges }) => {
      const processedEdges = layoutedEdges.map(e => {
        const polyline = extractElkPolyline(e);
        return {
          ...e,
          data: {
            ...(e.data ?? {}),
            polyline,
          }
        };
      });

      const directedNodes = layoutedNodes;
      const directedEdges = processedEdges;

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
    traceLimit,
    traceMax,
    rawNodes,
    rawEdges,
    dfgData,
    typeColors,
    fitViewWithOffset,
    resolvedVariant,
    layoutDirection,
    autoFitView,
    shiftForLegend,
    addLegendSpacer,
  ]);

  useEffect(() => {
    if (baseNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      setMeasuredGraphSize(null);
      return;
    }

    const resolvedNodes = baseNodes.map((node) => {
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
      const objtype = (edge.data as { objtype?: string } | undefined)?.objtype;
      if (objtype && typeVisibility[objtype] === false) return false;
      return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
    }).map(edge => ({
      ...edge,
      animated: animateEdges,
      data: {
        ...(edge.data ?? {}),
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

    nodesRef.current = resolvedNodes;
    edgesRef.current = filteredEdges;
    setNodes(resolvedNodes);
    setEdges(filteredEdges);
    reportGraphSize(resolvedNodes, filteredEdges);
  }, [baseNodes, baseEdges, typeVisibility, typeColors, reportGraphSize, animateEdges, dimTerminalEdges]);

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
    setTypeVisibility(prev => ({ ...prev, [type]: checked }));
  };

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
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeMouseMove={handleNodeMouseMove}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onEdgeMouseMove={handleEdgeMouseMove}
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
        preventScrolling={!interactionsDisabled}
      />

      {!hideChrome && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 16 + legendPosition.y,
            left: 16 + legendPosition.x,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: 'calc(100% - 32px)',
          }}
        >
          {showTitle && (
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>
                  Object-Centric DFG (Variants)
                </div>
                <GlobalFilterToggle filterEnabled={filterEnabled} onToggle={onToggleFilter} stopPropagation />
              </div>
            </div>
          )}

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
                <span
                  style={{ cursor: 'grab' }}
                  onPointerDown={handleLegendPointerDown}
                  onPointerMove={handleLegendPointerMove}
                  onPointerUp={handleLegendPointerUp}
                  onPointerCancel={handleLegendPointerUp}
                >
                  Object Types
                </span>
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
                  {legendCollapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>
              {!legendCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(typeColors).map(([type, color]) => (
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
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          justifyContent: 'space-between',
                          opacity: typeAvailability[type] !== true ? 0.4 : 1,
                        }}
                      >
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

                      {/* Per-type trace-count slider */}
                      {traceMax[type] !== undefined && traceMax[type] > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            opacity: typeAvailability[type] ? (typeVisibility[type] !== false ? 1 : 0.7) : 0.5,
                          }}
                        >
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Slider
                              min={0}
                              max={traceMax[type]}
                              step={1}
                              value={[traceLimit[type] ?? traceMax[type]]}
                              onValueChange={(values) => handleTraceLimitChange(type, values?.[0] ?? 0)}
                              disabled={typeAvailability[type] !== true}
                            />
                            <span style={{ fontSize: 12, color: '#475569', minWidth: 72, textAlign: 'right' }}>
                              {traceLimit[type] ?? traceMax[type]}/{traceMax[type]} variants
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
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
      {tooltipState && <MetricTooltip {...tooltipState} />}
    </div>
  );
}

export default NewOCDFGVariantsVisualizer;
