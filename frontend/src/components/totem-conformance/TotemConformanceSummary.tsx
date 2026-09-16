import type { TotemConformanceResponse } from "@/api/totemConformanceApi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ConformanceDimension } from "./conformanceLookup";
import {
  CONFORMANCE_DIMENSION_DEFINITIONS,
  formatConformanceMetric,
  getDimensionMetrics,
  getFitnessColor,
} from "./conformancePresentation";

export interface TotemConformanceSummaryProps {
  result: TotemConformanceResponse;
  activeDimension: ConformanceDimension;
  onDimensionChange: (dimension: ConformanceDimension) => void;
}

export function TotemConformanceSummary({
  result,
  activeDimension,
  onDimensionChange,
}: TotemConformanceSummaryProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Conformance metric dimension"
      className="grid overflow-hidden rounded-md border sm:grid-cols-3"
    >
      {CONFORMANCE_DIMENSION_DEFINITIONS.map((definition, index) => {
        const metrics = getDimensionMetrics(
          result.overall_metrics,
          definition.id
        );
        const active = definition.id === activeDimension;
        return (
          <Button
            key={definition.id}
            type="button"
            role="radio"
            aria-checked={active}
            variant="ghost"
            className={cn(
              "h-auto min-h-20 justify-start rounded-none px-4 py-3 text-left",
              index > 0 && "border-t sm:border-l sm:border-t-0",
              active && "bg-accent shadow-[inset_0_-2px_0_0_#2563EB]"
            )}
            onClick={() => onDimensionChange(definition.id)}
          >
            <span className="grid w-full gap-2">
              <span className="text-sm font-semibold">{definition.label}</span>
              <span className="grid grid-cols-2 gap-3 text-xs font-normal text-muted-foreground">
                <MetricValue
                  label="Fitness"
                  value={metrics.fitness}
                  highlighted={active}
                />
                <MetricValue
                  label="Precision"
                  value={metrics.precision}
                  highlighted={false}
                />
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function MetricValue({
  label,
  value,
  highlighted,
}: {
  label: string;
  value: number | null;
  highlighted: boolean;
}) {
  return (
    <span className="grid gap-0.5">
      <span>{label}</span>
      <span
        className="text-base font-semibold tabular-nums"
        style={{
          color: highlighted ? getFitnessColor(value) : "var(--foreground)",
        }}
      >
        {formatConformanceMetric(value)}
      </span>
    </span>
  );
}

export default TotemConformanceSummary;
