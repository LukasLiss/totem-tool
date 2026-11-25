/**
 * The dotted chart's "View" panel (opened from its control pill): what the
 * axes, colour and shape show and how the rows are ordered. Changes are a
 * draft until "Apply", since every change loads a new sample from the server.
 * The number of points is set in the "Sample" panel.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AxisOption, RowOrderDirection, RowOrderOption } from "./dottedChartUtils";
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
  rowOrderDirection: RowOrderDirection;
  maxPoints: number;
};

const SELECT_CLASS =
  "border-input bg-background h-8 w-full rounded-md border px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function DottedChartViewForm({
  fileId,
  config,
  onConfigChange,
}: {
  fileId?: number;
  config: DottedChartConfig;
  onConfigChange: (config: DottedChartConfig) => void;
}) {
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
  const showsObjectTypeSelect =
    axisToPrimaryControlValue(draftConfig.yAxis) === OBJECT_TYPE_CONTROL_VALUE;
  const selectOptions = useMemo(
    () => ({
      x_axis: withCurrentOption(options.x_axis, draftConfig.xAxis),
      y_axis: withCurrentOption(collapseObjectTypeOptions(options.y_axis), draftConfig.yAxis),
      color_by: withCurrentOption(options.color_by, draftConfig.colorBy),
      shape_by: withCurrentOption(options.shape_by, draftConfig.shapeBy),
    }),
    [draftConfig.colorBy, draftConfig.shapeBy, draftConfig.xAxis, draftConfig.yAxis, options]
  );

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  const updateDraftConfig = (patch: Partial<DottedChartConfig>) => {
    setDraftConfig((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="grid w-[248px] gap-2.5">
      <AxisSelect
        label="X axis"
        value={axisToControlValue(draftConfig.xAxis)}
        options={selectOptions.x_axis}
        onChange={(value) => updateDraftConfig({ xAxis: controlValueToAxis(value) })}
      />
      <AxisSelect
        label="Y axis"
        value={axisToPrimaryControlValue(draftConfig.yAxis)}
        options={selectOptions.y_axis}
        onChange={(value) =>
          updateDraftConfig({
            yAxis: controlValueToAxis(
              value === OBJECT_TYPE_CONTROL_VALUE ? objectTypeOptions[0]?.value ?? "object_id" : value
            ),
          })
        }
      />
      {showsObjectTypeSelect && (
        <AxisSelect
          label="Object type"
          value={selectedYObjectType}
          options={objectTypeOptions}
          onChange={(value) => updateDraftConfig({ yAxis: controlValueToAxis(value) })}
        />
      )}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[11px] text-muted-foreground">Y axis order</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-my-0.5 h-5 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground"
            title={
              draftConfig.rowOrderDirection === "desc"
                ? "Descending order. Click to sort ascending."
                : "Ascending order. Click to sort descending."
            }
            aria-label={`Y axis order direction: ${
              draftConfig.rowOrderDirection === "desc" ? "descending" : "ascending"
            }`}
            onClick={() =>
              updateDraftConfig({
                rowOrderDirection: draftConfig.rowOrderDirection === "desc" ? "asc" : "desc",
              })
            }
          >
            {draftConfig.rowOrderDirection === "desc" ? (
              <ArrowDownWideNarrow className="h-3 w-3" />
            ) : (
              <ArrowUpNarrowWide className="h-3 w-3" />
            )}
            {draftConfig.rowOrderDirection === "desc" ? "Desc" : "Asc"}
          </Button>
        </div>
        <select
          value={draftConfig.rowOrder}
          onChange={(event) => updateDraftConfig({ rowOrder: event.target.value as RowOrderOption })}
          className={SELECT_CLASS}
          aria-label="Y axis order"
        >
          {ROW_ORDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <AxisSelect
        label="Color by"
        value={axisToControlValue(draftConfig.colorBy)}
        options={selectOptions.color_by}
        onChange={(value) => updateDraftConfig({ colorBy: controlValueToAxis(value) })}
      />
      <AxisSelect
        label="Shape by"
        value={axisToControlValue(draftConfig.shapeBy)}
        options={selectOptions.shape_by}
        onChange={(value) => updateDraftConfig({ shapeBy: controlValueToAxis(value) })}
      />
      <p className="text-[11px] text-muted-foreground">
        {loadingOptions
          ? "Loading available columns…"
          : optionsError
            ? optionsError
            : hasPendingChanges
              ? "Not applied yet."
              : "Applied."}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={!hasPendingChanges}
          onClick={() => setDraftConfig(config)}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={!hasPendingChanges}
          onClick={() => onConfigChange(draftConfig)}
        >
          Apply
        </Button>
      </div>
    </div>
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
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as AxisControlValue)}
        className={SELECT_CLASS}
        aria-label={label}
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
