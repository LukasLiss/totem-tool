import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useFilterVersion, getEffectiveFilterConfig } from '@/store/filterStore';
import { isCancelledError } from '@/store/computationStore';
import ComputationStatus from '@/components/ComputationStatus';
import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesInitialized,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import {
  PlusIcon,
  MinusIcon,
  ScanIcon,
  LockIcon,
  UnlockIcon,
  NetworkIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  LocateFixedIcon,
} from 'lucide-react';
import { WidgetTitle } from '@/components/ui/WidgetTitle';
import { VisualizerEmptyState } from '@/components/ui/VisualizerEmptyState';
import { useObjectTypeColors } from '@/hooks/useObjectTypeColors';

const NO_TYPES: string[] = [];
import {
  occnNetToEditorGraph,
  groupSupportKey,
  DEFAULT_MAX_MARKER_GROUPS_PER_SIDE,
  type OccnEditorGraph,
  type OccnLayoutDirection,
  type OccnNet,
} from '../utils/occnTransform';
// Rendering is shared with the OCCN editor (one visual language across the
// tool): same node/edge components, markers-on-arcs overlay and ELK layout.
import { computeIncidentTypes, computeParallelOffsets } from '@/editors/occn/derive';
import MarkerOverlay from '@/editors/occn/MarkerOverlay';
import type { MarkerVis } from '@/editors/occn/markers';
import { elkLayeredPositions } from '@/editors/occn/model';
import OccnEdgeComponent from '@/editors/occn/OccnEdge';
import { HoverTooltip, type TooltipRow } from './MetricTooltip';
import OccnNodeComponent from '@/editors/occn/OccnNode';
import {
  OccnRenderContext,
  type OccnEdge as EditorOccnEdge,
  type OccnNode as EditorOccnNode,
} from '@/editors/occn/types';
import OccnOverflowBadges from './OccnOverflowBadges';
import SaveModelAssetButton from '@/components/SaveModelAssetDialog';
import { ControlPill, type PillSpot } from '@/components/canvas/ControlPill';
import { PillSlider } from '@/components/canvas/PillSlider';
import { ObjectTypePanel } from '@/components/canvas/ObjectTypePanel';
import { roomBelowForPill, type PillRegion } from '@/components/canvas/pillSpots';
import { FIT_GAP, bestFit, pillRect } from '@/components/canvas/canvasFit';
import { useCanvasGestures } from '@/components/canvas/useCanvasGestures';
import { useFitAvoidRects } from '@/components/canvas/useFitAvoidRects';
import { toast } from 'sonner';

/**
 * Free places for the control pill, as on the other graph canvases: the
 * bottom corners, or standing at the left or right edge (the threshold slider
 * then turns vertical). The top corners hold the title, legend and focus button.
 */
const OCCN_PILL_SPOTS: readonly PillSpot[] = ['bottom-right', 'bottom-left', 'left', 'right'];
/** React Flow's zoom limits of this view (dense logs lay out tens of thousands of px tall). */
const MIN_ZOOM = 0.005;
const MAX_ZOOM = 2.5;
/** Largest zoom of the fit, so a small net is not blown up. */
const FIT_MAX_ZOOM = 1.5;
/**
 * Room around the nodes' boxes for what is drawn outside them: self-loops
 * (they arc ~70 px above a node), the binding markers and the arrowheads.
 */
const FIT_MARGIN = 80;

interface OCCNVisualizerProps {
  height?: string | number;
  fileId?: number;
  data?: OccnNet;
  showControls?: boolean;
  initialInteractionLocked?: boolean;
  typeColorOverrides?: Record<string, string>;
  /** Cap on rendered marker groups per activity side; the rest collapse into "+N" chips. */
  maxMarkerGroupsPerSide?: number;
  /** Initial ELK layout direction; the in-canvas toggle takes over afterwards. */
  initialLayoutDirection?: OccnLayoutDirection;
  /** Initial relative occurrence threshold; the in-canvas slider takes over afterwards. */
  initialThreshold?: number;
  /** Restrict discovery to these object types; empty/undefined = all types. */
  objectTypes?: string[];
  /** Hide the in-canvas title when the surrounding page already renders one. */
  showTitle?: boolean;
  filterEnabled?: boolean;
  onToggleFilter?: () => void;
  localFilterParams?: Record<string, string>;
  /** Given: the title shows the local filter. */
  onLocalFilterChange?: (params: Record<string, string>) => void;
  /** Activity ids to emphasize as OCCN replay stopping points. */
  conformanceHighlights?: Record<string, 'non_fitting' | 'inconclusive'>;
  /** Log activities shown only to explain why replay stopped. */
  missingConformanceActivities?: string[];
  /** Model activities not reached by the displayed non-fitting replay. */
  unvisitedActivities?: string[];
}

const EMPTY_CONFORMANCE_HIGHLIGHTS: Record<
  string,
  'non_fitting' | 'inconclusive'
> = {};
const EMPTY_MISSING_CONFORMANCE_ACTIVITIES: string[] = [];
const EMPTY_UNVISITED_ACTIVITIES: string[] = [];

function resolveHeightValue(height: string | number) {
  return typeof height === 'number' ? `${height}px` : height;
}

function OCCNVisualizer({
  height = '100%',
  fileId,
  data,
  showControls = true,
  initialInteractionLocked = true,
  typeColorOverrides,
  maxMarkerGroupsPerSide,
  initialLayoutDirection = 'LR',
  initialThreshold = 0,
  objectTypes,
  showTitle = true,
  filterEnabled = true,
  onToggleFilter = () => {},
  localFilterParams,
  onLocalFilterChange,
  conformanceHighlights = EMPTY_CONFORMANCE_HIGHLIGHTS,
  missingConformanceActivities = EMPTY_MISSING_CONFORMANCE_ACTIVITIES,
  unvisitedActivities = EMPTY_UNVISITED_ACTIVITIES,
}: OCCNVisualizerProps) {
  const reactFlow = useReactFlow();
  const { fitView } = reactFlow;
  const nodesInitialized = useNodesInitialized();

  // Track the container's real size so we can re-fit once the dashboard/gridstack
  // cell is actually sized (see the reactive re-fit effect below).
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const [net, setNet] = useState<OccnNet | null>(data ?? null);
  const [graph, setGraph] = useState<OccnEditorGraph | null>(null);
  const [nodes, setNodes] = useState<EditorOccnNode[]>([]);
  const [edges, setEdges] = useState<EditorOccnEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(initialInteractionLocked);
  // The shared legend (collapsed at first) and where the movable pill sits.
  const [legendCollapsed, setLegendCollapsed] = useState(true);
  const [pillRegion, setPillRegion] = useState<PillRegion | null>(null);
  /**
   * The fit mode (the fit button grey), as on the DFG and the handover: the
   * net is placed clear of the title, legend and pill, and follows when they
   * or the box change, until the user zooms, pans or drags a node.
   */
  const [fitted, setFitted] = useState(true);
  const flowRef = useRef<HTMLDivElement>(null);
  const [tooltipState, setTooltipState] = useState<
    { x: number; y: number; title?: string; rows: TooltipRow[] } | null
  >(null);
  // Threshold applied to the fetch; the slider commits into this state.
  const [threshold, setThreshold] = useState(initialThreshold);
  const [layoutDirection, setLayoutDirection] = useState<OccnLayoutDirection>(initialLayoutDirection);
  // Bumped by the "re-layout" button to rerun ELK after manual dragging.
  const [layoutTick, setLayoutTick] = useState(0);
  const [layoutReadyTick, setLayoutReadyTick] = useState(0);
  const [nextConformanceFocus, setNextConformanceFocus] = useState(0);

  const nodeTypes = useMemo(() => ({ occn: OccnNodeComponent }), []);
  const edgeTypes = useMemo(() => ({ occnArc: OccnEdgeComponent }), []);

  const onNodesChange = useCallback(
    (changes: NodeChange<EditorOccnNode>[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<EditorOccnEdge>[]) =>
      setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const filterVersion = useFilterVersion();
  const effectiveLocalParams = localFilterParams ?? {};
  const effectiveFilterVersion = filterEnabled ? filterVersion : 0;

  // Normalized to a string so the fetch effect doesn't re-run on array identity.
  const objectTypesParam = (objectTypes ?? []).map((t) => t.trim()).filter(Boolean).join(',');

  // Fetch the serialized net. A `data` prop bypasses the fetch entirely.
  useEffect(() => {
    if (data) {
      setNet(data);
      setError(null);
      return;
    }
    if (fileId == null) {
      setNet(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const filterConfig = getEffectiveFilterConfig(
      Object.keys(effectiveLocalParams).length > 0 ? effectiveLocalParams : undefined,
      filterEnabled,
    );
    if (filterConfig._noResults) { setNet(null); setLoading(false); return; }
    axios
      .get<OccnNet>(
        `/api/occn/?file_id=${fileId}&relativeOccuranceThreshold=${threshold}${
          objectTypesParam ? `&object_types=${encodeURIComponent(objectTypesParam)}` : ''
        }`,
        { ...filterConfig, signal: controller.signal },
      )
      .then(({ data: payload }) => {
        if (cancelled) return;
        setNet(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setNet(null);
        setError(
          isCancelledError(err)
            ? 'Computation cancelled.'
            : err?.response?.data?.error ?? 'Failed to discover the OCCN for this file.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Leaving the page or changing the inputs stops the running discovery on
    // the backend as well, so it does not block the next request.
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [data, fileId, threshold, objectTypesParam, filterEnabled, effectiveFilterVersion, effectiveLocalParams]);

  // From the log's full type list, so a filter doesn't shift the colors.

  const typeColors = useObjectTypeColors(fileId, net?.object_types ?? NO_TYPES, typeColorOverrides);

  // Convert + layout whenever the net (or direction, or the re-layout tick)
  // changes. ELK layout is async, so guard against a stale run resolving
  // after the inputs changed.
  useEffect(() => {
    if (!net) {
      setGraph(null);
      setNodes([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    const nextGraph = occnNetToEditorGraph(net, { maxMarkerGroupsPerSide });
    // Extra spacing vs. the editor default: arcs carry markers and self-loops
    // arc ~70px+ above the nodes.
    elkLayeredPositions(
      nextGraph.nodes.map((n) => ({ id: n.id, kind: n.data.kind })),
      nextGraph.edges,
      {
        direction: layoutDirection === 'TB' ? 'DOWN' : 'RIGHT',
        layerGap: 220,
        nodeGap: 100,
        edgeNodeGap: 60,
      },
    )
      .catch(() => {
        // Fall back to unpositioned nodes rather than an empty canvas.
        toast.error('OCCN layout failed');
        return {} as Record<string, { x: number; y: number }>;
      })
      .then((positions) => {
        if (cancelled) return;
        setGraph(nextGraph);
        setNodes(
          nextGraph.nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              conformanceStatus: conformanceHighlights[node.id],
              conformanceMissingFromModel:
                missingConformanceActivities.includes(node.id),
              conformanceUnvisited:
                unvisitedActivities.includes(node.id) &&
                conformanceHighlights[node.id] == null,
            },
            position: positions[node.id] ?? { x: 0, y: 0 },
          })),
        );
        setEdges(
          nextGraph.edges.map((edge) => ({
            ...edge,
            data: {
              ...edge.data,
              conformanceUnvisited:
                unvisitedActivities.includes(edge.source) ||
                unvisitedActivities.includes(edge.target),
            },
          }))
        );
        setLayoutReadyTick((tick) => tick + 1);
        // A new layout opens fitted again.
        setFitted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    net,
    fitView,
    maxMarkerGroupsPerSide,
    layoutDirection,
    layoutTick,
    conformanceHighlights,
    missingConformanceActivities,
    unvisitedActivities,
  ]);

  // Track the container size via a ResizeObserver. In a dashboard the gridstack
  // cell is sized asynchronously, so the initial layout's fitView often runs
  // against a zero-size container and leaves the graph in a corner.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const width = Math.max(0, container.clientWidth);
      const height = Math.max(0, container.clientHeight);
      setContainerSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The canvas controls the fit keeps clear of (title, legend, focus button:
  // marked data-fit-avoid), and the pill.
  const avoidRects = useFitAvoidRects(containerRef, [legendCollapsed, showControls, showTitle, Boolean(net)]);
  const fitAvoid = useMemo(
    () => [...avoidRects, ...(pillRegion ? [pillRect(pillRegion)] : [])],
    [avoidRects, pillRegion],
  );

  /** Places the whole net as large as fits clear of the controls (bestFit), centred while it has room. */
  const placeFitted = useCallback(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0 || nodes.length === 0) return;
    const bounds = reactFlow.getNodesBounds(nodes);
    const graph = { x: bounds.x - FIT_MARGIN, y: bounds.y - FIT_MARGIN, w: bounds.width + 2 * FIT_MARGIN, h: bounds.height + 2 * FIT_MARGIN };
    const fit = bestFit(
      { w: containerSize.width, h: containerSize.height },
      { w: graph.w, h: graph.h },
      { top: FIT_GAP, right: FIT_GAP, bottom: FIT_GAP, left: FIT_GAP },
      fitAvoid,
      FIT_MAX_ZOOM,
    );
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit.scale));
    void reactFlow.setViewport({ x: fit.x - graph.x * zoom, y: fit.y - graph.y * zoom, zoom });
  }, [containerSize.width, containerSize.height, nodes, reactFlow, fitAvoid]);

  // In the fit mode, fit once the container has real dimensions and the
  // layout has positioned (and measured) the nodes, and again whenever the
  // box, the layout or a control changes. Gated on positioned nodes so we
  // never fit against origin {0,0} placeholders before ELK has resolved.
  useEffect(() => {
    if (!fitted) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    if (nodes.length === 0 || !nodesInitialized || layoutReadyTick === 0) return;
    const frame = window.requestAnimationFrame(placeFitted);
    return () => cancelAnimationFrame(frame);
    // placeFitted changes with the nodes' positions too: a fit per layout
    // (layoutReadyTick), not per node drag (which ends the fit mode anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted, containerSize.width, containerSize.height, nodes.length, nodesInitialized, layoutReadyTick, fitAvoid]);

  const renderContext = useMemo(
    () => ({
      typeColors,
      incidentTypes: computeIncidentTypes(edges, net?.object_types ?? []),
      parallelOffset: computeParallelOffsets(edges),
      activeType: null,
    }),
    [typeColors, edges, net],
  );

  const markerTitle = useCallback(
    (vis: MarkerVis) => {
      const [related, objectType, [min, max]] = vis.marker;
      const cardinality = `${min}..${max === -1 ? '∞' : max}`;
      const base =
        vis.ref.side === 'img'
          ? `Input marker — from ${related} (${objectType}), cardinality ${cardinality}`
          : `Output marker — to ${related} (${objectType}), cardinality ${cardinality}`;
      const support = graph?.groupSupport.get(
        groupSupportKey(vis.ref.activity, vis.ref.side, vis.ref.groupIndex),
      );
      return support != null ? `${base} — group support: ${support}` : base;
    },
    [graph],
  );

  const interactionsDisabled = interactionLocked;

  /**
   * Trackpad, pinch and touch, as on the DFG and the handover (the shared
   * hook) instead of React Flow's own wheel handling, which zooms on every
   * wheel event: two fingers move the net, a pinch or the mouse wheel zooms at
   * the pointer, two fingers on a touch screen do both. Dragging the
   * background stays React Flow's. The lock switches all of it off.
   */
  useCanvasGestures(flowRef, !interactionsDisabled, {
    onPan: (dx, dy) => {
      setFitted(false);
      const vp = reactFlow.getViewport();
      void reactFlow.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom });
    },
    onZoom: (scale, clientX, clientY) => {
      const rect = flowRef.current?.getBoundingClientRect();
      if (!rect) return;
      setFitted(false);
      const vp = reactFlow.getViewport();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * scale));
      // The point under the pointer stays where it is.
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const k = zoom / vp.zoom;
      void reactFlow.setViewport({ x: px - (px - vp.x) * k, y: py - (py - vp.y) * k, zoom });
    },
  });

  /**
   * Arc hover card. These handlers must sit on the ReactFlow, not inside the
   * edge component: with `elementsSelectable` off and no edge handlers React
   * Flow marks each edge `inactive`, which sets pointer-events: none on the
   * arc and no hover would ever reach it.
   */
  const showArcTooltip = useCallback(
    (event: React.MouseEvent, edge: EditorOccnEdge) => {
      const dependence = edge.data?.dependenceMeasure;
      setTooltipState({
        x: event.clientX,
        y: event.clientY,
        title: `${edge.source} \u2192 ${edge.target}`,
        rows: [
          { label: 'Object type', value: edge.data?.objectType || 'unknown' },
          {
            label: 'Dependence',
            value: dependence != null ? dependence.toFixed(2) : 'N/A',
          },
        ],
      });
    },
    [],
  );
  const highlightedNodeIds = useMemo(
    () =>
      Object.entries(conformanceHighlights)
        .sort(
          ([leftId, leftStatus], [rightId, rightStatus]) =>
            Number(rightStatus === 'non_fitting') - Number(leftStatus === 'non_fitting') ||
            leftId.localeCompare(rightId),
        )
        .map(([activity]) => activity),
    [conformanceHighlights],
  );
  const focusableNodes = useMemo(
    () =>
      highlightedNodeIds
        .map((activity) => nodes.find((node) => node.id === activity))
        .filter((node): node is EditorOccnNode => node != null),
    [highlightedNodeIds, nodes],
  );
  const highlightedNodeKey = highlightedNodeIds.join('\u0000');
  const focusTarget =
    focusableNodes.length > 0
      ? focusableNodes[nextConformanceFocus % focusableNodes.length]
      : null;

  useEffect(() => {
    setNextConformanceFocus(0);
  }, [highlightedNodeKey]);

  const focusStoppingPoint = useCallback(() => {
    if (!focusTarget) return;
    setFitted(false);
    void fitView({
      nodes: [focusTarget],
      padding: 1.2,
      minZoom: 0.8,
      maxZoom: 1.4,
      duration: 600,
    });
    setNextConformanceFocus((current) =>
      focusableNodes.length > 1 ? (current + 1) % focusableNodes.length : current,
    );
  }, [fitView, focusTarget, focusableNodes.length]);

  return (
    <div
      ref={containerRef}
      data-occn-readonly
      // The box in which the fit looks for the controls (data-fit-avoid).
      data-canvas-shell
      style={{ height: resolveHeightValue(height), width: '100%', position: 'relative' }}
      className={interactionsDisabled ? 'interactions-disabled' : ''}
    >

      {/* The shared editor node renders connection handles; this view is read-only. */}
      <style>{`
        [data-occn-readonly] .react-flow__handle {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        /* React Flow marks an edge "inactive" — pointer-events: none — when
           nothing is selectable and no click handler is set, which is exactly
           this view while interactions are locked. Locking is about panning
           and dragging, not about an arc refusing to say what it is, so the
           arcs keep their pointer events and the hover card works either way. */
        [data-occn-readonly] .react-flow__edge.inactive {
          pointer-events: auto;
        }
      `}</style>
      <OccnRenderContext.Provider value={renderContext}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          ref={flowRef}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={{ hideAttribution: true }}
          // Dense logs at threshold 0 lay out tens of thousands of px tall;
          // the fit cannot go below minZoom, so keep it low enough to fit.
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          nodesDraggable={!interactionsDisabled}
          nodesConnectable={false}
          elementsSelectable={!interactionsDisabled}
          panOnDrag={!interactionsDisabled}
          // Wheel and pinch are the shared gestures' (useCanvasGestures above).
          zoomOnPinch={false}
          zoomOnScroll={false}
          panOnScroll={false}
          zoomOnDoubleClick={!interactionsDisabled}
          preventScrolling={!interactionsDisabled}
          // The user moving the view (drag, double-click) or a node ends the fit
          // mode; the fit's own moves come without an event.
          onMoveStart={(event) => {
            if (event) setFitted(false);
          }}
          onNodeDragStart={() => setFitted(false)}
          onEdgeMouseEnter={showArcTooltip}
          onEdgeMouseMove={showArcTooltip}
          onEdgeMouseLeave={() => setTooltipState(null)}
        >
          {graph && (
            <MarkerOverlay
              nodes={nodes}
              edges={edges}
              bindings={graph.bindings}
              typeColors={typeColors}
              parallelOffset={renderContext.parallelOffset}
              focusedGroup={null}
              interactive={false}
              markerTitle={markerTitle}
              mutedActivities={unvisitedActivities}
            />
          )}
          {graph && (
            <OccnOverflowBadges
              nodes={nodes}
              overflow={graph.overflow}
              cap={maxMarkerGroupsPerSide ?? DEFAULT_MAX_MARKER_GROUPS_PER_SIDE}
            />
          )}
        </ReactFlow>
      </OccnRenderContext.Provider>

      {focusTarget ? (
        <Button
          type="button"
          variant="outline"
          data-fit-avoid="header"
          onClick={focusStoppingPoint}
          className={`absolute right-4 top-4 z-20 bg-background shadow-md ${
            conformanceHighlights[focusTarget.id] === 'non_fitting'
              ? 'border-red-500 text-red-700 hover:text-red-800 dark:text-red-400'
              : 'border-amber-500 text-amber-700 hover:text-amber-800 dark:text-amber-400'
          }`}
          title={`Focus ${focusTarget.id}`}
          aria-label={`Focus stopping point ${focusTarget.id}`}
        >
          <LocateFixedIcon className="size-4" />
          Focus stopping point
          {focusableNodes.length > 1 ? (
            <span className="tabular-nums">
              {(nextConformanceFocus % focusableNodes.length) + 1}/
              {focusableNodes.length}
            </span>
          ) : null}
        </Button>
      ) : null}

      {data == null && fileId == null && (
        <VisualizerEmptyState
          label="Object-Centric Causal Net"
          message="Select an event log to discover its causal net."
        />
      )}

      {(loading || error) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: loading ? 'auto' : 'none',
            zIndex: 20,
            fontFamily: 'var(--font-primary, Inter, sans-serif)',
            fontSize: 14,
            color: error ? '#B91C1C' : '#475569',
          }}
        >
          {loading ? (
            <ComputationStatus
              fileId={fileId}
              urlIncludes="/occn/"
              fallback={<span>Discovering OCCN…</span>}
            />
          ) : (
            error
          )}
        </div>
      )}

      {(showControls || showTitle) && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            flexDirection: 'column',
            // As the DFG: the legend close under the title, down to just above
            // the pill when the pill is on this side.
            gap: 8,
            maxHeight: `calc(100% - ${16 + roomBelowForPill(pillRegion, true, { reach: 280 })}px)`,
            zIndex: 15,
          }}
        >
          {/* The title stays when the controls are switched off: it holds the filters. */}
          {showTitle && (
            <div data-fit-avoid="header" style={{ alignSelf: 'flex-start' }}>
              <WidgetTitle
                label="Object-Centric Causal Net (OCCN)"
                fileId={fileId}
                filterEnabled={filterEnabled}
                onToggleFilter={onToggleFilter}
                localFilterParams={localFilterParams}
                onLocalFilterChange={onLocalFilterChange}
              />
            </div>
          )}

          {showControls && Object.keys(typeColors).length > 0 && (
            // The shared legend of the graph canvases (colours only here).
            <div
              // Collapsed: a corner chip (the net starts below it, or beside it where it stays centred).
              data-fit-avoid={legendCollapsed ? 'corner' : 'optional'}
              style={{ display: 'flex', flexDirection: 'column', minHeight: 0, alignSelf: 'flex-start' }}
            >
              <ObjectTypePanel
                testId="occn-legend"
                types={Object.entries(typeColors).map(([type, color]) => ({ type, color }))}
                collapsed={legendCollapsed}
                onCollapsedChange={setLegendCollapsed}
              />
            </div>
          )}
        </div>
      )}

      {showControls && (
        <>
          <ControlPill spots={OCCN_PILL_SPOTS} storageKey="occn" onRegionChange={setPillRegion}>
            {/* Commits on release and re-discovers the net. */}
            <PillSlider
              label="Threshold"
              ariaLabel="Relative occurrence threshold"
              title="Relative occurrence threshold — commits on release and re-discovers the net"
              value={threshold}
              min={0}
              max={1}
              step={0.05}
              onCommit={setThreshold}
              disabled={data != null || loading}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                setLayoutDirection((prev) => (prev === 'LR' ? 'TB' : 'LR'))
              }
              className="rounded-full h-9 w-9"
              title={
                layoutDirection === 'LR'
                  ? 'Switch to top-to-bottom layout'
                  : 'Switch to left-to-right layout'
              }
            >
              {layoutDirection === 'LR' ? (
                <ArrowRightIcon className="h-4 w-4" />
              ) : (
                <ArrowDownIcon className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setLayoutTick((tick) => tick + 1)}
              className="rounded-full h-9 w-9"
              title="Re-run automatic layout"
            >
              <NetworkIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                setFitted(false);
                void reactFlow.zoomIn?.();
              }}
              className="rounded-full h-9 w-9"
              title="Zoom in"
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                setFitted(false);
                void reactFlow.zoomOut?.();
              }}
              className="rounded-full h-9 w-9"
              title="Zoom out"
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              // Grey while the view follows the fit; zooming, panning or dragging a node ends it.
              variant={fitted ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => {
                setFitted(true);
                placeFitted();
              }}
              className="rounded-full h-9 w-9"
              title={fitted ? 'Fitted to view: follows the panels until you zoom or pan' : 'Fit to view'}
              aria-label="Fit to view"
              aria-pressed={fitted}
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
            {data == null && fileId != null && (
              <SaveModelAssetButton
                fileId={fileId}
                filterEnabled={filterEnabled}
                modelType="OCCN"
                params={{
                  relative_occurrence_threshold: threshold,
                  object_types: (objectTypes ?? [])
                    .map((t) => t.trim())
                    .filter(Boolean),
                }}
                disabled={loading || net == null}
                iconOnly
                className="rounded-full h-9 w-9"
              />
            )}
          </ControlPill>
        </>
      )}
      {tooltipState && <HoverTooltip {...tooltipState} />}
    </div>
  );
}

export default OCCNVisualizer;
export type { OCCNVisualizerProps };
