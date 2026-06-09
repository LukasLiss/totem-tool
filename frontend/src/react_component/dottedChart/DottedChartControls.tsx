import { useEffect, useMemo, useState } from "react";
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
import {
  DEFAULT_DOTTED_CHART_OPTIONS,
  useDottedChartOptions,
  type DottedChartOption,
} from "./useDottedChartOptions";

export type DottedChartConfig = {
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  sortBy: SortOption | AxisOption;
  maxPoints: number;
};

type DottedChartControlsProps = {
  fileId?: number;
  config: DottedChartConfig;
  onConfigChange: (config: DottedChartConfig) => void;
  className?: string;
};

type AxisControlValue = string;

export function DottedChartControls({
  fileId,
  config,
  onConfigChange,
  className,
}: DottedChartControlsProps) {
  const { options, loading: loadingOptions, error: optionsError } = useDottedChartOptions(fileId);
  const [draftConfig, setDraftConfig] = useState<DottedChartConfig>(config);
  const sortAxis = "type" in draftConfig.sortBy ? draftConfig.sortBy : draftConfig.sortBy.field;
  const sortDirection = "type" in draftConfig.sortBy ? "asc" : draftConfig.sortBy.direction ?? "asc";
  const hasPendingChanges = useMemo(
    () => JSON.stringify(draftConfig) !== JSON.stringify(config),
    [config, draftConfig]
  );
  const selectOptions = useMemo(
    () => ({
      x_axis: withCurrentOption(options.x_axis, draftConfig.xAxis),
      y_axis: withCurrentOption(options.y_axis, draftConfig.yAxis),
      color_by: withCurrentOption(options.color_by, draftConfig.colorBy),
      shape_by: withCurrentOption(options.shape_by, draftConfig.shapeBy),
      sort_by: withCurrentOption(options.sort_by, sortAxis),
    }),
    [draftConfig.colorBy, draftConfig.shapeBy, draftConfig.xAxis, draftConfig.yAxis, options, sortAxis]
  );

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  const updateDraftConfig = (patch: Partial<DottedChartConfig>) => {
    setDraftConfig((current) => ({ ...current, ...patch }));
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
            value={axisToControlValue(draftConfig.xAxis)}
            options={selectOptions.x_axis}
            onChange={(value) => updateDraftConfig({ xAxis: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Y Axis"
            value={axisToControlValue(draftConfig.yAxis)}
            options={selectOptions.y_axis}
            onChange={(value) => updateDraftConfig({ yAxis: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Color By"
            value={axisToControlValue(draftConfig.colorBy)}
            options={selectOptions.color_by}
            onChange={(value) => updateDraftConfig({ colorBy: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Shape By"
            value={axisToControlValue(draftConfig.shapeBy)}
            options={selectOptions.shape_by}
            onChange={(value) => updateDraftConfig({ shapeBy: controlValueToAxis(value) })}
          />
          <AxisSelect
            label="Sort By"
            value={axisToControlValue(sortAxis)}
            options={selectOptions.sort_by}
            onChange={(value) =>
              updateDraftConfig({
                sortBy: { field: controlValueToAxis(value), direction: sortDirection },
              })
            }
          />
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sort Direction</Label>
            <select
              value={sortDirection}
              onChange={(event) =>
                updateDraftConfig({
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
                {draftConfig.maxPoints.toLocaleString()}
              </span>
            </div>
            <Slider
              min={1000}
              max={50000}
              step={1000}
              value={[draftConfig.maxPoints]}
              onValueChange={(values) =>
                updateDraftConfig({ maxPoints: values[0] ?? draftConfig.maxPoints })
              }
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 md:col-span-3 xl:col-span-6">
            <span className="mr-auto text-xs text-muted-foreground">
              {loadingOptions
                ? "Loading available columns..."
                : optionsError
                  ? optionsError
                  : hasPendingChanges
                    ? "Changes are not applied yet."
                    : "Configuration is applied."}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasPendingChanges}
              onClick={() => setDraftConfig(config)}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!hasPendingChanges}
              onClick={() => onConfigChange(draftConfig)}
            >
              Confirm
            </Button>
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
  options: DottedChartOption[];
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
  if (axis.type === "event_attribute") return axis.name;
  return axis.type;
}

function controlValueToAxis(value: AxisControlValue): AxisOption {
  if (isBuiltinAxis(value)) return { type: value };
  return { type: "event_attribute", name: value };
}

function withCurrentOption(options: DottedChartOption[], axis: AxisOption): DottedChartOption[] {
  const currentValue = axisToControlValue(axis);
  if (options.some((option) => option.value === currentValue)) return options;
  const fallback = findDefaultOption(currentValue);
  if (fallback) return [fallback, ...options];
  return [
    {
      label: currentValue,
      value: currentValue,
      kind: axis.type === "event_attribute" ? "categorical" : "none",
    },
    ...options,
  ];
}

function findDefaultOption(value: string): DottedChartOption | undefined {
  return Object.values(DEFAULT_DOTTED_CHART_OPTIONS)
    .flat()
    .find((option) => option.value === value);
}

function isBuiltinAxis(
  value: string
): value is "time" | "timestamp" | "timestamp_unix" | "since_start" | "activity" | "none" {
  return ["time", "timestamp", "timestamp_unix", "since_start", "activity", "none"].includes(value);
}
