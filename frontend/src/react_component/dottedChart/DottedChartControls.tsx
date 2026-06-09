import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { AxisOption, SortOption } from "./dottedChartUtils";

export type DottedChartConfig = {
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  sortBy: SortOption | AxisOption;
  maxPoints: number;
};

type DottedChartControlsProps = {
  config: DottedChartConfig;
  onConfigChange: (config: DottedChartConfig) => void;
  className?: string;
};

const AXIS_OPTIONS: Array<{ label: string; value: AxisControlValue }> = [
  { label: "Time", value: "time" },
  { label: "Timestamp", value: "timestamp" },
  { label: "Timestamp (Unix)", value: "timestamp_unix" },
  { label: "Since Start", value: "since_start" },
  { label: "Activity", value: "activity" },
];

const OPTIONAL_AXIS_OPTIONS: Array<{ label: string; value: AxisControlValue }> = [
  ...AXIS_OPTIONS,
  { label: "None", value: "none" },
];

type AxisControlValue = AxisOption["type"];

export function DottedChartControls({
  config,
  onConfigChange,
  className,
}: DottedChartControlsProps) {
  const sortAxis = "type" in config.sortBy ? config.sortBy : config.sortBy.field;
  const sortDirection = "type" in config.sortBy ? "asc" : config.sortBy.direction ?? "asc";

  const updateConfig = (patch: Partial<DottedChartConfig>) => {
    onConfigChange({ ...config, ...patch });
  };

  return (
    <Collapsible defaultOpen={false} className={cn("rounded-md border bg-background", className)}>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Chart configuration
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1">
            Configure
            <ChevronDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="grid gap-3 border-t px-3 py-3 md:grid-cols-3 xl:grid-cols-6">
          <AxisSelect
            label="X Axis"
            value={axisToControlValue(config.xAxis)}
            options={AXIS_OPTIONS}
            onChange={(value) => updateConfig({ xAxis: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Y Axis"
            value={axisToControlValue(config.yAxis)}
            options={AXIS_OPTIONS}
            onChange={(value) => updateConfig({ yAxis: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Color By"
            value={axisToControlValue(config.colorBy)}
            options={OPTIONAL_AXIS_OPTIONS}
            onChange={(value) => updateConfig({ colorBy: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Shape By"
            value={axisToControlValue(config.shapeBy)}
            options={OPTIONAL_AXIS_OPTIONS}
            onChange={(value) => updateConfig({ shapeBy: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Sort By"
            value={axisToControlValue(sortAxis)}
            options={AXIS_OPTIONS}
            onChange={(value) =>
              updateConfig({
                sortBy: { field: controlValueToAxis(value), direction: sortDirection },
              })
            }
          />
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sort Direction</Label>
            <select
              value={sortDirection}
              onChange={(event) =>
                updateConfig({
                  sortBy: { field: sortAxis, direction: event.target.value as "asc" | "desc" },
                })
              }
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
          <div className="space-y-2 md:col-span-3 xl:col-span-6">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Max Points</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {config.maxPoints.toLocaleString()}
              </span>
            </div>
            <Slider
              min={1000}
              max={50000}
              step={1000}
              value={[config.maxPoints]}
              onValueChange={(values) => updateConfig({ maxPoints: values[0] ?? config.maxPoints })}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AxisSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: AxisControlValue;
  options: Array<{ label: string; value: AxisControlValue }>;
  onChange: (value: AxisControlValue) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as AxisControlValue)}
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function axisToControlValue(axis: AxisOption): AxisControlValue {
  return axis.type;
}

function controlValueToAxis(value: AxisControlValue): AxisOption {
  return { type: value } as AxisOption;
}
