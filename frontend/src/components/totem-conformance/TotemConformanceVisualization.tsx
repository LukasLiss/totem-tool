import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RefreshCcw } from "lucide-react";

import type { TotemConformanceResponse } from "@/api/totemConformanceApi";
import TotemObjectTypeNode from "@/components/totem/TotemObjectTypeNode";
import TotemRelationEdge from "@/components/totem/TotemRelationEdge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  createTotemConformanceLookup,
  type ConformanceDimension,
} from "./conformanceLookup";
import { FITNESS_BANDS } from "./conformancePresentation";
import {
  TotemConformanceDetails,
  type TotemConformanceSelection,
} from "./TotemConformanceDetails";
import { TotemConformanceSummary } from "./TotemConformanceSummary";
import {
  createTotemFlowEdges,
  createTotemFlowNodes,
  type TotemConformanceEdgeType,
  type TotemConformanceNodeType,
} from "./visualizationFlow";
import type { TotemVisualizationModel } from "./visualizationModel";

const nodeTypes = { totemConformanceNode: TotemObjectTypeNode };
const edgeTypes = { totemConformanceEdge: TotemRelationEdge };

export interface TotemConformanceVisualizationProps {
  model: TotemVisualizationModel;
  result: TotemConformanceResponse;
  className?: string;
  height?: number | string;
}

/** Read-only graph renderer. Data loading and conformance execution stay outside. */
export function TotemConformanceVisualization({
  model,
  result,
  className,
  height = "clamp(460px, 62vh, 680px)",
}: TotemConformanceVisualizationProps) {
  return (
    <TotemConformanceContent
      key={`${result.file_id}:${result.asset_id}`}
      model={model}
      result={result}
      className={className}
      height={height}
    />
  );
}

function TotemConformanceContent(props: TotemConformanceVisualizationProps) {
  const [activeDimension, setActiveDimension] =
    useState<ConformanceDimension>("temporal");
  const [selection, setSelection] = useState<TotemConformanceSelection | null>(
    null
  );
  const lookup = useMemo(
    () => createTotemConformanceLookup(props.result),
    [props.result]
  );

  return (
    <section className="grid gap-4" aria-label="TOTeM conformance results">
      <TotemConformanceSummary
        result={props.result}
        activeDimension={activeDimension}
        onDimensionChange={setActiveDimension}
      />
      <ResizableSplit>
        <ReactFlowProvider>
          <TotemConformanceCanvas
            {...props}
            lookup={lookup}
            selection={selection}
            onSelect={setSelection}
          />
        </ReactFlowProvider>
        <TotemConformanceDetails
          result={props.result}
          lookup={lookup}
          selection={selection}
          activeDimension={activeDimension}
          onClearSelection={() => setSelection(null)}
        />
      </ResizableSplit>
    </section>
  );
}

const DETAILS_WIDTH_KEY = "totem-conformance:details-width";
const DEFAULT_DETAILS_WIDTH = 480;
const MIN_DETAILS_WIDTH = 300;
const MIN_CANVAS_WIDTH = 360;

function readStoredDetailsWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(DETAILS_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_DETAILS_WIDTH
      ? stored
      : DEFAULT_DETAILS_WIDTH;
  } catch {
    return DEFAULT_DETAILS_WIDTH;
  }
}

/**
 * Model canvas and details side by side on wide screens, split by a handle
 * the user can drag (or move with the arrow keys). The chosen width is kept
 * per browser. Narrow screens stack both and hide the handle.
 */
function ResizableSplit({ children }: { children: [ReactNode, ReactNode] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [detailsWidth, setDetailsWidth] = useState(readStoredDetailsWidth);

  const clampWidth = useCallback((width: number) => {
    const available = containerRef.current?.getBoundingClientRect().width ?? 0;
    const max = Math.max(MIN_DETAILS_WIDTH, available - MIN_CANVAS_WIDTH);
    return Math.round(Math.min(Math.max(width, MIN_DETAILS_WIDTH), max));
  }, []);

  const commitWidth = useCallback(
    (width: number) => {
      const next = clampWidth(width);
      setDetailsWidth(next);
      try {
        window.localStorage.setItem(DETAILS_WIDTH_KEY, String(next));
      } catch {
        // Storage may be unavailable; the width then lasts for this view only.
      }
    },
    [clampWidth]
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) commitWidth(rect.right - move.clientX);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 80 : 20;
    if (event.key === "ArrowLeft") commitWidth(detailsWidth + step);
    else if (event.key === "ArrowRight") commitWidth(detailsWidth - step);
    else if (event.key === "Home") commitWidth(DEFAULT_DETAILS_WIDTH);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_auto_var(--details-width)] xl:items-stretch xl:gap-0"
      style={{ "--details-width": `${detailsWidth}px` } as CSSProperties}
    >
      {children[0]}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details panel"
        aria-valuenow={detailsWidth}
        aria-valuemin={MIN_DETAILS_WIDTH}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        className="group hidden w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none xl:flex"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => commitWidth(DEFAULT_DETAILS_WIDTH)}
      >
        <span className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/60 group-focus-visible:bg-ring" />
      </div>
      {children[1]}
    </div>
  );
}

interface TotemConformanceCanvasProps
  extends TotemConformanceVisualizationProps {
  lookup: ReturnType<typeof createTotemConformanceLookup>;
  selection: TotemConformanceSelection | null;
  onSelect: (selection: TotemConformanceSelection | null) => void;
}

function TotemConformanceCanvas({
  model,
  result,
  className,
  height,
  lookup,
  selection,
  onSelect,
}: TotemConformanceCanvasProps) {
  const { fitView } = useReactFlow();
  // React Flow owns the node positions from here on, so a box the user drags
  // stays where they put it. Only the edges are rebuilt per selection — they
  // carry the conformance colours and no position.
  const [nodes, setNodes] = useState<TotemConformanceNodeType[]>(() =>
    createTotemFlowNodes(model)
  );
  const seededModel = useRef(model);

  useEffect(() => {
    if (seededModel.current === model) return;
    seededModel.current = model;
    setNodes(createTotemFlowNodes(model));
  }, [model]);

  // Boxes can be moved but never removed: the model is read-only here.
  const onNodesChange = useCallback(
    (changes: NodeChange<TotemConformanceNodeType>[]) =>
      setNodes((current) =>
        applyNodeChanges(
          changes.filter((change) => change.type !== "remove"),
          current
        )
      ),
    []
  );

  // Restores the generated layout after manual dragging, as the TOTeM Miner's
  // own Relayout button does. fitView waits a frame so React Flow has taken
  // the reset positions before it measures them.
  const handleRelayout = useCallback(() => {
    setNodes(createTotemFlowNodes(model));
    requestAnimationFrame(() => fitView({ padding: 0.25 }));
  }, [fitView, model]);

  // Selection is applied on top of the live nodes rather than baked into them,
  // so clicking a box never rebuilds the layout.
  const selectedObjectTypeId =
    selection?.kind === "objectType" ? selection.objectType : null;
  const displayedNodes = useMemo(
    () =>
      nodes.map((node) =>
        node.selected === (node.id === selectedObjectTypeId)
          ? node
          : { ...node, selected: node.id === selectedObjectTypeId }
      ),
    [nodes, selectedObjectTypeId]
  );

  const edges = useMemo(
    () =>
      createTotemFlowEdges(model, {
        conformance: lookup,
        selectedRelationId:
          selection?.kind === "relation" ? selection.relationId : null,
      }),
    [lookup, model, selection]
  );
  const styleHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={cn(
        "flex min-h-[460px] min-w-0 w-full flex-col overflow-hidden rounded-md border bg-background",
        className
      )}
      style={{ height: styleHeight }}
      aria-label={`TOTeM conformance model for asset ${result.asset_id}`}
      data-asset-id={result.asset_id}
    >
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="text-xs font-medium text-foreground"
            title="Each temporal marker, log cardinality and event cardinality is coloured separately for both directions, by the lower of its fitness and precision."
          >
            Conformance per element
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={handleRelayout}
            title="Restore the generated layout"
          >
            <RefreshCcw className="size-3.5" />
            Relayout
          </Button>
        </div>
        <FitnessLegend />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <ReactFlow<TotemConformanceNodeType, TotemConformanceEdgeType>
          nodes={displayedNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesConnectable={false}
          deleteKeyCode={null}
          elementsSelectable
          onNodeClick={(_, node) =>
            onSelect({ kind: "objectType", objectType: node.id })
          }
          onEdgeClick={(_, edge) =>
            onSelect({
              kind: "relation",
              relationId: edge.id,
              source: edge.source,
              target: edge.target,
            })
          }
          onPaneClick={() => onSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.35}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="#CBD5E1"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function FitnessLegend() {
  return (
    <div
      aria-label="Fitness color legend"
      className="pointer-events-none flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
    >
      {FITNESS_BANDS.map((band) => (
        <span key={band.id} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ background: band.color }}
          />
          {band.label}
        </span>
      ))}
    </div>
  );
}

export default TotemConformanceVisualization;
