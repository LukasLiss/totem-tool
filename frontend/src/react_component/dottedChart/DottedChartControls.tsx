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
import type { AxisOption, RowOrderOption } from "./dottedChartUtils";
import {
  OBJECT_TYPE_CONTROL_VALUE,
  ROW_ORDER_OPTIONS,
  axisToControlValue,
  axisToPrimaryControlValue,
  collapseObjectTypeOptions,
  controlValueToAxis,
  getObjectTypeValue,
  withCurrentOption,
  type AxisControlValue,
} from "./dottedChartAxisOptions";
import { useDottedChartOptions, type DottedChartOption } from "./useDottedChartOptions";

export type DottedChartConfig = {
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  rowOrder: RowOrderOption;
  maxPoints: number;
};

type DottedChartControlsProps = {
  fileId?: number;
  config: DottedChartConfig;
  onConfigChange: (config: DottedChartConfig) => void;
  className?: string;
};

export function DottedChartControls({
  fileId,
  config,
  onConfigChange,
  className,
}: DottedChartControlsProps) {
  const { options, loading: loadingOptions, error: optionsError } = useDottedChartOptions(fileId);
  const [draftConfig, setDraftConfig] = useState<DottedChartConfig>(config);
  const hasPendingChanges = useMemo(
    () => JSON.stringify(draftConfig) !== JSON.stringify(config),
    [config, draftConfig]
  );
  const objectTypeOptions = useMemo(
    () => options.y_axis.filter((option) => option.value.startsWith("object_type:")),
    [options.y_axis]
  );
  const selectedYObjectType = getObjectTypeValue(draftConfig.yAxis, objectTypeOptions);
  const selectOptions = useMemo(
    () => ({
      x_axis: withCurrentOption(options.x_axis, draftConfig.xAxis),
      y_axis: withCurrentOption(collapseObjectTypeOptions(options.y_axis), draftConfig.yAxis),
      color_by: withCurrentOption(options.color_by, draftConfig.colorBy),
      shape_by: withCurrentOption(options.shape_by, draftConfig.shapeBy),
    }),
    [
      draftConfig.colorBy,
      draftConfig.shapeBy,
      draftConfig.xAxis,
      draftConfig.yAxis,
      options,
    ]
  );

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  const updateDraftConfig = (patch: Partial<DottedChartConfig>) => {
    setDraftConfig((current) => ({ ...current, ...patch }));
  };
  const updateConfigWithAxisChange = (axisKey: "xAxis" | "yAxis", axis: AxisOption) => {
    setDraftConfig((current) => ({ ...current, [axisKey]: axis }));
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
            onChange={(value) => updateConfigWithAxisChange("xAxis", controlValueToAxis(value))}
          />
          <AxisSelect
            label="Y Axis"
            value={axisToPrimaryControlValue(draftConfig.yAxis)}
            options={selectOptions.y_axis}
            onChange={(value) =>
              updateConfigWithAxisChange(
                "yAxis",
                controlValueToAxis(
                  value === OBJECT_TYPE_CONTROL_VALUE
                    ? objectTypeOptions[0]?.value ?? "object_id"
                    : value
                )
              )
            }
          />
          {axisToPrimaryControlValue(draftConfig.yAxis) === OBJECT_TYPE_CONTROL_VALUE && (
            <AxisSelect
              label="Object Type"
              value={selectedYObjectType}
              options={objectTypeOptions}
              onChange={(value) =>
                updateConfigWithAxisChange("yAxis", controlValueToAxis(value))
              }
            />
          )}
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
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Y Axis Order</Label>
            <select
              value={draftConfig.rowOrder}
              onChange={(event) =>
                updateDraftConfig({
                  rowOrder: event.target.value as RowOrderOption,
                })
              }
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {ROW_ORDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
