import { useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { TotemConformanceResponse } from "@/api/totemConformanceApi";
import { cn } from "@/lib/utils";

import {
  createTotemConformanceLookup,
  type ConformanceDimension,
} from "./conformanceLookup";
import {
  FITNESS_BANDS,
  getDimensionDefinition,
} from "./conformancePresentation";
import {
  TotemConformanceDetails,
  type TotemConformanceSelection,
} from "./TotemConformanceDetails";
import TotemConformanceEdge from "./TotemConformanceEdge";
import TotemConformanceNode from "./TotemConformanceNode";
import { TotemConformanceSummary } from "./TotemConformanceSummary";
import {
  createTotemFlowElements,
  type TotemConformanceEdgeType,
  type TotemConformanceNodeType,
} from "./visualizationFlow";
import type { TotemVisualizationModel } from "./visualizationModel";

const nodeTypes = { totemConformanceNode: TotemConformanceNode };
const edgeTypes = { totemConformanceEdge: TotemConformanceEdge };

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
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] xl:items-stretch">
        <ReactFlowProvider>
          <TotemConformanceCanvas
            {...props}
            lookup={lookup}
            activeDimension={activeDimension}
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
      </div>
    </section>
  );
}

interface TotemConformanceCanvasProps
  extends TotemConformanceVisualizationProps {
  activeDimension: ConformanceDimension;
  lookup: ReturnType<typeof createTotemConformanceLookup>;
  selection: TotemConformanceSelection | null;
  onSelect: (selection: TotemConformanceSelection | null) => void;
}

function TotemConformanceCanvas({
  model,
  result,
  className,
  height,
  activeDimension,
  lookup,
  selection,
  onSelect,
}: TotemConformanceCanvasProps) {
  const elements = useMemo(
    () =>
      createTotemFlowElements(model, {
        conformance: lookup,
        dimension: activeDimension,
        selectedObjectTypeId:
          selection?.kind === "objectType" ? selection.objectType : null,
        selectedRelationId:
          selection?.kind === "relation" ? selection.relationId : null,
      }),
    [activeDimension, lookup, model, selection]
  );
  const styleHeight = typeof height === "number" ? `${height}px` : height;
  const activeDefinition = getDimensionDefinition(activeDimension);

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
        <span className="text-xs font-medium text-foreground">
          {activeDefinition.label} fitness
        </span>
        <FitnessLegend />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <ReactFlow<TotemConformanceNodeType, TotemConformanceEdgeType>
          nodes={elements.nodes}
          edges={elements.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
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
