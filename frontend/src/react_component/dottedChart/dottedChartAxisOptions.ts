/**
 * Translating between the dotted chart's axis settings and the values of its
 * option dropdowns, shared by DottedChartControls and the dashboard widget's
 * settings popup. (Moved here unchanged from DottedChartControls.)
 */
import type { AxisOption, RowOrderOption } from "./dottedChartUtils";
import { DEFAULT_DOTTED_CHART_OPTIONS, type DottedChartOption } from "./useDottedChartOptions";

export type AxisControlValue = string;
export const OBJECT_TYPE_CONTROL_VALUE = "__object_type__";
export const ROW_ORDER_OPTIONS: Array<{ label: string; value: RowOrderOption }> = [
  { label: "First occurrence", value: "first_occurrence" },
  { label: "Last occurrence", value: "last_occurrence" },
];

export function axisToControlValue(axis: AxisOption): AxisControlValue {
  if (axis.type === "event_attribute") return axis.name;
  return axis.type;
}

export function axisToPrimaryControlValue(axis: AxisOption): AxisControlValue {
  const value = axisToControlValue(axis);
  if (value.startsWith("object_type:")) return OBJECT_TYPE_CONTROL_VALUE;
  return value;
}

export function controlValueToAxis(value: AxisControlValue): AxisOption {
  if (isBuiltinAxis(value)) return { type: value };
  return { type: "event_attribute", name: value };
}

export function withCurrentOption(options: DottedChartOption[], axis: AxisOption): DottedChartOption[] {
  const currentValue = axisToPrimaryControlValue(axis);
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

export function collapseObjectTypeOptions(options: DottedChartOption[]): DottedChartOption[] {
  const collapsed: DottedChartOption[] = [];
  let hasObjectTypes = false;

  options.forEach((option) => {
    if (option.value.startsWith("object_type:")) {
      hasObjectTypes = true;
      return;
    }
    collapsed.push(option);
  });

  if (!hasObjectTypes) return collapsed;

  const insertAfterActivity = collapsed.findIndex((option) => option.value === "activity");
  const objectTypeOption = {
    label: "Object Type",
    value: OBJECT_TYPE_CONTROL_VALUE,
    kind: "categorical" as const,
  };

  if (insertAfterActivity === -1) return [objectTypeOption, ...collapsed];
  return [
    ...collapsed.slice(0, insertAfterActivity + 1),
    objectTypeOption,
    ...collapsed.slice(insertAfterActivity + 1),
  ];
}

export function getObjectTypeValue(axis: AxisOption, options: DottedChartOption[]): AxisControlValue {
  const value = axisToControlValue(axis);
  if (value.startsWith("object_type:")) return value;
  return options[0]?.value ?? "";
}

/** The option's label for an axis setting (e.g. "Time", "Activity", an object type's name). */
export function axisOptionLabel(options: DottedChartOption[], axis: AxisOption): string {
  const value = axisToControlValue(axis);
  return options.find((option) => option.value === value)?.label ?? findDefaultOption(value)?.label ?? value;
}

/** Y axes with one row per object (of a type, or all objects), rather than per value. */
export function isObjectRowAxis(axis: AxisOption): boolean {
  const value = axisToControlValue(axis);
  return value === "object_id" || value.startsWith("object_type:");
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
