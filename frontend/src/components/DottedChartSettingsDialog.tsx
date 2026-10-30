/**
 * The OC dotted chart widget's settings popup body: the settings of the
 * chart's configuration panel (DottedChartControls) beside a draft of the
 * chart. Axes, row order and max points are data; color and shape are style.
 * It works on a draft of the settings, mounted on every open, and only hands
 * it over on Apply.
 */

import React, { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { DottedChartConfig } from "@/react_component/dottedChart/DottedChartControls";
import {
  OBJECT_TYPE_CONTROL_VALUE,
  ROW_ORDER_OPTIONS,
  axisOptionLabel,
  axisToControlValue,
  axisToPrimaryControlValue,
  collapseObjectTypeOptions,
  controlValueToAxis,
  getObjectTypeValue,
  withCurrentOption,
} from "@/react_component/dottedChart/dottedChartAxisOptions";
import type { DottedChartOption, DottedChartOptions } from "@/react_component/dottedChart/useDottedChartOptions";
import { ChartSettingsLayout, type ChartSettingsTab } from "./sql-widgets/chartSettings";
import DottedChartSketch from "./DottedChartSketch";

/** A labeled dropdown of chart options. */
function OptionSelect({ id, label, value, options, onChange }: {
  id: string;
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const DottedChartSettingsBody: React.FC<{
  id: string;
  initial: DottedChartConfig;
  options: DottedChartOptions;
  loadingOptions: boolean;
  optionsError: string | null;
  fileId?: number;
  /** Explanation of the draft, the same as in the edit tile. */
  sketchHint: string;
  onApply: (config: DottedChartConfig) => void;
  onCancel: () => void;
}> = ({ id, initial, options, loadingOptions, optionsError, fileId, sketchHint, onApply, onCancel }) => {
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<ChartSettingsTab>("data");
  const update = (patch: Partial<DottedChartConfig>) => setDraft((current) => ({ ...current, ...patch }));

  // The same option lists as the chart's configuration panel.
  const objectTypeOptions = useMemo(
    () => options.y_axis.filter((option: DottedChartOption) => option.value.startsWith("object_type:")),
    [options.y_axis],
  );
  const selectOptions = useMemo(
    () => ({
      x_axis: withCurrentOption(options.x_axis, draft.xAxis),
      y_axis: withCurrentOption(collapseObjectTypeOptions(options.y_axis), draft.yAxis),
      color_by: withCurrentOption(options.color_by, draft.colorBy),
      shape_by: withCurrentOption(options.shape_by, draft.shapeBy),
    }),
    [draft.colorBy, draft.shapeBy, draft.xAxis, draft.yAxis, options],
  );
  const yIsObjectType = axisToPrimaryControlValue(draft.yAxis) === OBJECT_TYPE_CONTROL_VALUE;

  const status = !fileId
    ? "Select an event log in the application sidebar to load its columns."
    : loadingOptions
      ? "Loading available columns..."
      : optionsError;

  return (
    <ChartSettingsLayout
      heading="OC dotted chart settings"
      idPrefix={id}
      onApply={() => onApply(draft)}
      onCancel={onCancel}
      tab={tab}
      onTabChange={setTab}
      dataTab={
        <div className="space-y-4 text-left">
          <p className="text-sm text-muted-foreground">
            Every event as a dot over time, one row per activity, attribute value or object.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <OptionSelect
              id={`${id}-x`}
              label="X axis"
              value={axisToControlValue(draft.xAxis)}
              options={selectOptions.x_axis}
              onChange={(value) => update({ xAxis: controlValueToAxis(value) })}
            />
            <OptionSelect
              id={`${id}-y`}
              label="Y axis"
              value={axisToPrimaryControlValue(draft.yAxis)}
              options={selectOptions.y_axis}
              onChange={(value) =>
                update({
                  yAxis: controlValueToAxis(
                    value === OBJECT_TYPE_CONTROL_VALUE ? objectTypeOptions[0]?.value ?? "object_id" : value,
                  ),
                })
              }
            />
            {yIsObjectType && (
              <OptionSelect
                id={`${id}-y-object-type`}
                label="Object type"
                value={getObjectTypeValue(draft.yAxis, objectTypeOptions)}
                options={objectTypeOptions}
                onChange={(value) => update({ yAxis: controlValueToAxis(value) })}
              />
            )}
            <OptionSelect
              id={`${id}-row-order`}
              label="Y axis order"
              value={draft.rowOrder}
              options={ROW_ORDER_OPTIONS}
              onChange={(value) => update({ rowOrder: value as DottedChartConfig["rowOrder"] })}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Max points</Label>
              <span className="text-sm tabular-nums text-muted-foreground">{draft.maxPoints.toLocaleString()}</span>
            </div>
            <Slider
              min={1000}
              max={50000}
              step={1000}
              value={[draft.maxPoints]}
              onValueChange={(values) => update({ maxPoints: values[0] ?? draft.maxPoints })}
            />
          </div>
          {status && <p className="text-xs text-muted-foreground">{status}</p>}
        </div>
      }
      styleTab={
        <div className="grid grid-cols-2 gap-4 text-left">
          <OptionSelect
            id={`${id}-color`}
            label="Color by"
            value={axisToControlValue(draft.colorBy)}
            options={selectOptions.color_by}
            onChange={(value) => update({ colorBy: controlValueToAxis(value) })}
          />
          <OptionSelect
            id={`${id}-shape`}
            label="Shape by"
            value={axisToControlValue(draft.shapeBy)}
            options={selectOptions.shape_by}
            onChange={(value) => update({ shapeBy: controlValueToAxis(value) })}
          />
        </div>
      }
      sketch={
        <DottedChartSketch
          config={draft}
          xLabel={axisOptionLabel(options.x_axis, draft.xAxis)}
          yLabel={axisOptionLabel(options.y_axis, draft.yAxis)}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint={sketchHint}
    />
  );
};

export default DottedChartSettingsBody;
