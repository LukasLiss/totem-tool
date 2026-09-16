import { useState } from "react";
import { ArrowRight, CircleX, GitBranch, Workflow } from "lucide-react";

import type {
  ActivityHistogram,
  FitnessPrecision,
  RelationTypeHistogram,
  TotemConformanceResponse,
  TypePairConformance,
} from "@/api/totemConformanceApi";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import {
  getActivityHistograms,
  getDirectionalTypePairMetrics,
  getPairHistogram,
  getRelationTypeHistograms,
  type ConformanceDimension,
  type TotemConformanceLookup,
} from "./conformanceLookup";
import {
  CONFORMANCE_DIMENSION_DEFINITIONS,
  formatConformanceMetric,
  getDimensionDefinition,
  getFitnessColor,
} from "./conformancePresentation";
import { createHistogramRows } from "./histogramPresentation";

export type TotemConformanceSelection =
  | { kind: "objectType"; objectType: string }
  | {
      kind: "relation";
      relationId: string;
      source: string;
      target: string;
    };

export interface TotemConformanceDetailsProps {
  result: TotemConformanceResponse;
  lookup: TotemConformanceLookup;
  selection: TotemConformanceSelection | null;
  activeDimension: ConformanceDimension;
  onClearSelection: () => void;
}

export function TotemConformanceDetails({
  result,
  lookup,
  selection,
  activeDimension,
  onClearSelection,
}: TotemConformanceDetailsProps) {
  return (
    <aside className="flex min-h-56 min-w-0 flex-col overflow-hidden rounded-md border bg-background xl:min-h-0">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">Details</h2>
        {selection && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            title="Clear selection"
            onClick={onClearSelection}
          >
            <CircleX />
            <span className="sr-only">Clear selection</span>
          </Button>
        )}
      </header>

      <div className="max-h-[560px] min-h-0 flex-1 overflow-y-auto p-4 xl:max-h-none">
        {!selection ? (
          <p className="text-sm text-muted-foreground">No model element selected.</p>
        ) : selection.kind === "objectType" ? (
          <ObjectTypeDetails
            objectType={selection.objectType}
            result={result}
            activeDimension={activeDimension}
          />
        ) : (
          <RelationDetails
            key={selection.relationId}
            selection={selection}
            lookup={lookup}
            activeDimension={activeDimension}
          />
        )}
      </div>
    </aside>
  );
}

function ObjectTypeDetails({
  objectType,
  result,
  activeDimension,
}: {
  objectType: string;
  result: TotemConformanceResponse;
  activeDimension: ConformanceDimension;
}) {
  const metrics = result.object_type_metrics[objectType];
  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <Workflow className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="truncate text-sm font-semibold" title={objectType}>
          {objectType}
        </h3>
      </div>
      {metrics ? (
        <MetricTable
          rows={CONFORMANCE_DIMENSION_DEFINITIONS.map(({ id, label }) => ({
            dimension: id,
            label,
            metrics: {
              fitness: metrics[id].avg_fitness,
              precision: metrics[id].avg_precision,
            },
          }))}
          activeDimension={activeDimension}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No object-type metrics available.
        </p>
      )}
    </div>
  );
}

function RelationDetails({
  selection,
  lookup,
  activeDimension,
}: {
  selection: Extract<TotemConformanceSelection, { kind: "relation" }>;
  lookup: TotemConformanceLookup;
  activeDimension: ConformanceDimension;
}) {
  const [direction, setDirection] = useState<"forward" | "reverse">("forward");
  const directional = getDirectionalTypePairMetrics(
    lookup,
    selection.source,
    selection.target
  );
  const source = direction === "forward" ? selection.source : selection.target;
  const target = direction === "forward" ? selection.target : selection.source;
  const metrics = direction === "forward" ? directional.forward : directional.reverse;

  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="truncate text-sm font-semibold">
          {selection.source} / {selection.target}
        </h3>
      </div>

      <DirectionSelector
        source={selection.source}
        target={selection.target}
        direction={direction}
        onDirectionChange={setDirection}
      />

      {metrics ? (
        <MetricTable
          rows={relationMetricRows(metrics)}
          activeDimension={activeDimension}
          showModelRelation
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          No metrics available for {source} to {target}.
        </p>
      )}

      <Separator />
      <HistogramDetails
        key={`${activeDimension}:${source}:${target}`}
        lookup={lookup}
        activeDimension={activeDimension}
        source={source}
        target={target}
      />
    </div>
  );
}

function DirectionSelector({
  source,
  target,
  direction,
  onDirectionChange,
}: {
  source: string;
  target: string;
  direction: "forward" | "reverse";
  onDirectionChange: (direction: "forward" | "reverse") => void;
}) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-md border">
      {(
        [
          { id: "forward", from: source, to: target },
          { id: "reverse", from: target, to: source },
        ] as const
      ).map((option, index) => (
        <Button
          key={option.id}
          type="button"
          variant="ghost"
          className={cn(
            "h-auto min-w-0 rounded-none px-2 py-2",
            index > 0 && "border-l",
            direction === option.id && "bg-accent"
          )}
          aria-pressed={direction === option.id}
          aria-label={`${option.from} to ${option.to}`}
          onClick={() => onDirectionChange(option.id)}
        >
          <span className="flex min-w-0 items-center justify-center gap-1">
            <span className="truncate" title={option.from}>
              {option.from}
            </span>
            <ArrowRight className="size-3 shrink-0" />
            <span className="truncate" title={option.to}>
              {option.to}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}

interface MetricRow {
  dimension: ConformanceDimension;
  label: string;
  metrics: FitnessPrecision;
  modelRelation?: string | null;
}

function MetricTable({
  rows,
  activeDimension,
  showModelRelation = false,
}: {
  rows: MetricRow[];
  activeDimension: ConformanceDimension;
  showModelRelation?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full table-fixed text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-medium">Metric</th>
            {showModelRelation && (
              <th className="px-2 py-2 text-right font-medium">Model</th>
            )}
            <th className="px-2 py-2 text-right font-medium">Fitness</th>
            <th className="px-2 py-2 text-right font-medium">Precision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.dimension}
              className={cn(
                "border-t",
                row.dimension === activeDimension && "bg-accent/60"
              )}
            >
              <td className="truncate px-2 py-2 font-medium" title={row.label}>
                {getDimensionDefinition(row.dimension).shortLabel}
              </td>
              {showModelRelation && (
                <td className="truncate px-2 py-2 text-right" title={row.modelRelation ?? undefined}>
                  {row.modelRelation ?? "-"}
                </td>
              )}
              <MetricCell value={row.metrics.fitness} />
              <MetricCell value={row.metrics.precision} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCell({ value }: { value: number | null }) {
  return (
    <td
      className="px-2 py-2 text-right font-medium tabular-nums"
      style={{ color: getFitnessColor(value) }}
    >
      {formatConformanceMetric(value)}
    </td>
  );
}

function relationMetricRows(metrics: TypePairConformance): MetricRow[] {
  return CONFORMANCE_DIMENSION_DEFINITIONS.map(({ id, label }) => ({
    dimension: id,
    label,
    metrics: metrics[id],
    modelRelation: metrics[id].model_relation,
  }));
}

function HistogramDetails({
  lookup,
  activeDimension,
  source,
  target,
}: {
  lookup: TotemConformanceLookup;
  activeDimension: ConformanceDimension;
  source: string;
  target: string;
}) {
  const aggregate = getPairHistogram(
    lookup,
    activeDimension,
    source,
    target
  );
  const breakdown = histogramBreakdown(
    lookup,
    activeDimension,
    source,
    target
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h4 className="text-xs font-semibold">
          {getDimensionDefinition(activeDimension).label} distribution
        </h4>
        {aggregate ? (
          <HistogramBars
            counts={aggregate.counts}
            dimension={activeDimension}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            No aggregate histogram available.
          </p>
        )}
      </div>

      {breakdown.length > 0 && (
        <HistogramBreakdown
          records={breakdown}
          dimension={activeDimension}
          detailLabel={
            activeDimension === "event_cardinality" ? "Activity" : "Relation type"
          }
        />
      )}
    </div>
  );
}

type HistogramDetailRecord = {
  label: string;
  counts: Record<string, number>;
};

function histogramBreakdown(
  lookup: TotemConformanceLookup,
  dimension: ConformanceDimension,
  source: string,
  target: string
): HistogramDetailRecord[] {
  if (dimension === "event_cardinality") {
    return getActivityHistograms(lookup, source, target).map(
      (record: ActivityHistogram) => ({
        label: record.activity,
        counts: record.counts,
      })
    );
  }
  return getRelationTypeHistograms(lookup, dimension, source, target).map(
    (record: RelationTypeHistogram) => ({
      label: record.relation_type,
      counts: record.counts,
    })
  );
}

function HistogramBreakdown({
  records,
  dimension,
  detailLabel,
}: {
  records: HistogramDetailRecord[];
  dimension: ConformanceDimension;
  detailLabel: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState("0");
  const selected = records[Number(selectedIndex)] ?? records[0];
  return (
    <div className="grid gap-2">
      <Select value={selectedIndex} onValueChange={setSelectedIndex}>
        <SelectTrigger size="sm" aria-label={detailLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {records.map((record, index) => (
            <SelectItem key={`${record.label}:${index}`} value={String(index)}>
              {record.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <HistogramBars counts={selected.counts} dimension={dimension} />
    </div>
  );
}

function HistogramBars({
  counts,
  dimension,
}: {
  counts: Record<string, number>;
  dimension: ConformanceDimension;
}) {
  const rows = createHistogramRows(counts, dimension);
  return (
    <div className="grid gap-1.5" aria-label="Histogram">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(72px,auto)_1fr_36px] items-center gap-2 text-[11px]"
        >
          <span className="truncate text-muted-foreground" title={row.label}>
            {row.label}
          </span>
          <span className="h-2 overflow-hidden rounded-sm bg-muted">
            <span
              className="block h-full bg-slate-500"
              style={{ width: `${row.ratio * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

export default TotemConformanceDetails;
