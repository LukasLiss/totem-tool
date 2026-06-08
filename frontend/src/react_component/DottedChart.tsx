import React, { useMemo, useState } from "react";
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatAxisTick,
  formatTimestamp,
  makeAxisLabelLookup,
  makeColorScale,
  makeShapeScale,
  objectSummary,
  renderPointShape,
  toChartPoints,
  type AxisOption,
  type ChartPoint,
  type DottedChartViewport,
  type OCEvent,
  type SortOption,
} from "./dottedChart/dottedChartUtils";
import { useDottedChartData } from "./dottedChart/useDottedChartData";

interface DottedChartProps {
  fileId?: number;
  xAxis?: AxisOption;
  yAxis?: AxisOption;
  colorBy?: AxisOption;
  shapeBy?: AxisOption;
  sortBy?: SortOption | AxisOption;
  maxPoints?: number;
  viewport?: DottedChartViewport;
  className?: string;
  onEventClick?: (event: OCEvent) => void;
}

const DEFAULT_X_AXIS: AxisOption = { type: "time" };
const DEFAULT_Y_AXIS: AxisOption = { type: "activity" };
const DEFAULT_COLOR_BY: AxisOption = { type: "activity" };
const DEFAULT_SHAPE_BY: AxisOption = { type: "none" };
const DEFAULT_SORT_BY: AxisOption = { type: "time" };

export default function DottedChart({
  fileId,
  xAxis = DEFAULT_X_AXIS,
  yAxis = DEFAULT_Y_AXIS,
  colorBy = DEFAULT_COLOR_BY,
  shapeBy = DEFAULT_SHAPE_BY,
  sortBy = DEFAULT_SORT_BY,
  maxPoints = 20_000,
  viewport,
  className,
  onEventClick,
}: DottedChartProps) {
  const { data, loading, error } = useDottedChartData({
    fileId,
    xAxis,
    yAxis,
    colorBy,
    shapeBy,
    sortBy,
    maxPoints,
    viewport,
  });

  const points = useMemo(() => toChartPoints(data?.events ?? []), [data?.events]);
  const colorScale = useMemo(() => makeColorScale(points), [points]);
  const shapeScale = useMemo(() => makeShapeScale(points), [points]);
  const xLabels = useMemo(() => makeAxisLabelLookup(points, "x"), [points]);
  const yLabels = useMemo(() => makeAxisLabelLookup(points, "y"), [points]);
  const xDomain = useMemo(() => getDataDomain(points.map((point) => point.chartX)), [points]);
  const yTicks = useMemo(() => getUniqueSortedValues(points.map((point) => point.chartY)), [points]);
  const yDomain = useMemo(() => getRowDomain(yTicks), [yTicks]);

  if (!fileId) {
    return <DottedChartState className={className} message="Select an event log to view the dotted chart" />;
  }

  if (loading && !data) {
    return (
      <div className={cn("flex h-[420px] flex-col gap-3 p-4", className)}>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    );
  }

  if (error) {
    return <DottedChartState className={className} message={error} />;
  }

  if (!points.length) {
    return <DottedChartState className={className} message="No dotted chart events for this selection" />;
  }

  return (
    <div className={cn("relative flex h-[420px] min-h-[320px] flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          Showing {points.length.toLocaleString()} of {data?.total_count.toLocaleString() ?? 0} events
          {data?.sampled ? " (sampled)" : ""}
        </span>
        <span>{data?.outlier_count.toLocaleString() ?? 0} outliers preserved</span>
      </div>

      <ChartContainer
        config={{ events: { label: "Events", color: "var(--chart-1)" } }}
        className="min-h-0 flex-1 rounded-md border bg-background p-2"
      >
        <ScatterChart margin={{ top: 16, right: 20, bottom: 18, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="chartX"
            name="x"
            type="number"
            domain={xDomain}
            tickFormatter={(value) => formatXAxisTick(value, xAxis, xLabels)}
            tickMargin={8}
            minTickGap={28}
          />
          <YAxis
            dataKey="chartY"
            name="y"
            type="number"
            domain={yDomain}
            ticks={yTicks}
            interval={0}
            allowDecimals={false}
            tickFormatter={(value) => yLabels.get(Number(value)) ?? formatAxisTick(Number(value))}
            tickMargin={8}
            width={140}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            wrapperStyle={{ pointerEvents: "auto" }}
            content={
              <DottedChartTooltip
                xAxis={xAxis}
                yAxis={yAxis}
                colorBy={colorBy}
                shapeBy={shapeBy}
                sortBy={sortBy}
              />
            }
          />
          <Scatter
            name="Events"
            data={points}
            isAnimationActive={false}
            shape={(props: any) => {
              const point = props.payload as ChartPoint;
              const color = colorScale.get(point.colorKey) ?? "var(--chart-1)";
              const shape = shapeScale.get(point.shapeKey) ?? "circle";
              return renderPointShape(props.cx, props.cy, color, shape, () => onEventClick?.(point));
            }}
          />
        </ScatterChart>
      </ChartContainer>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 text-sm text-muted-foreground">
          Loading dotted chart...
        </div>
      )}
    </div>
  );
}

function getDataDomain(values: number[]): [number, number] {
  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];

  return [min, max];
}

function getRowDomain(values: number[]): [number, number] {
  const [min, max] = getDataDomain(values);
  return [min - 0.5, max + 0.5];
}

function getUniqueSortedValues(values: number[]): number[] {
  return Array.from(new Set(values.filter(Number.isFinite))).sort((a, b) => a - b);
}

function formatXAxisTick(
  value: number | string,
  axis: AxisOption,
  labels: Map<number, string>
): string {
  const numericValue = Number(value);

  if (isTimeAxis(axis) && Number.isFinite(numericValue)) {
    return formatUnixDateTick(numericValue);
  }

  return labels.get(numericValue) ?? formatAxisTick(numericValue);
}

function isTimeAxis(axis: AxisOption): boolean {
  return axis.type === "time" || axis.type === "timestamp" || axis.type === "timestamp_unix";
}

function formatUnixDateTick(value: number): string {
  const milliseconds = Math.abs(value) >= 1_000_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toLocaleDateString();
}

function formatAxisLabel(axis: AxisOption): string {
  switch (axis.type) {
    case "time":
    case "timestamp":
    case "timestamp_unix":
      return "Time";
    case "since_start":
      return "Time Since Start";
    case "activity":
      return "Activity";
    case "event_attribute":
      return axis.name;
    case "none":
      return "None";
    default:
      return "Value";
  }
}

function DottedChartState({ className, message }: { className?: string; message: string }) {
  return (
    <div className={cn("flex h-[320px] items-center justify-center rounded-md border bg-background p-4", className)}>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function DottedChartTooltip({
  active,
  payload,
  xAxis,
  yAxis,
  colorBy,
  shapeBy,
  sortBy,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  sortBy: SortOption | AxisOption;
}) {
  const [showDetails, setShowDetails] = useState(false);

  if (!active || !payload?.length) return null;

  const point = payload[0].payload as ChartPoint;
  const detailRows = buildDetailRows(point, { xAxis, yAxis, colorBy, shapeBy, sortBy });

  return (
    <div className="max-w-[360px] rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">Activity: {point.activity}</span>
        <span className="text-muted-foreground">activity_id: {point.id}</span>
      </div>
      <div className="grid gap-1 text-muted-foreground">
        <div>
          <span className="text-foreground">{formatAxisLabel(xAxis)} (X-Axis):</span> {point.xLabel}
        </div>
        <div>
          <span className="text-foreground">{formatAxisLabel(yAxis)} (Y-Axis):</span> {point.yLabel}
        </div>
      </div>
      <button
        type="button"
        className="mt-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setShowDetails((current) => !current)}
      >
        {showDetails ? "Hide details" : "Show more details"}
      </button>
      {showDetails && (
        <div className="mt-2 grid max-h-64 gap-1 overflow-auto border-t pt-2 text-muted-foreground">
          {detailRows.map((row) => (
            <div key={row.label}>
              <span className="text-foreground">{formatDetailLabel(row)}:</span> {row.value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type DetailRow = {
  label: string;
  value: string;
  roles?: string[];
};

type DetailRoleContext = {
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
  shapeBy: AxisOption;
  sortBy: SortOption | AxisOption;
};

function buildDetailRows(point: ChartPoint, context: DetailRoleContext): DetailRow[] {
  return [
    {
      label: "Activity",
      value: point.activity,
      roles: rolesForAxisValue("activity", context),
    },
    {
      label: "activity_id",
      value: point.id,
    },
    {
      label: "Time",
      value: formatTimestamp(point.timestamp, point.timestamp_unix),
      roles: rolesForAxisValue("time", context),
    },
    {
      label: "timestamp_unix",
      value: String(point.timestamp_unix),
      roles: rolesForAxisValue("time", context),
    },
    {
      label: formatAxisLabel(context.xAxis),
      value: point.xLabel,
      roles: ["X-Axis"],
    },
    {
      label: formatAxisLabel(context.yAxis),
      value: point.yLabel,
      roles: ["Y-Axis"],
    },
    {
      label: "color_value",
      value: valueLabel(point.color_value),
      roles: context.colorBy.type === "none" ? [] : ["Color"],
    },
    {
      label: "shape_value",
      value: valueLabel(point.shape_value),
      roles: context.shapeBy.type === "none" ? [] : ["Shape"],
    },
    {
      label: "row_id",
      value: valueLabel(point.row_id),
      roles: ["Y row"],
    },
    {
      label: "row_index",
      value: valueLabel(point.row_index),
      roles: ["Y row order"],
    },
    {
      label: "event_index_in_row",
      value: valueLabel(point.event_index_in_row),
      roles: ["Point order in row"],
    },
    {
      label: "Objects",
      value: objectSummary(point.objects),
    },
  ];
}

function rolesForAxisValue(valueType: "activity" | "time", context: DetailRoleContext): string[] {
  const roles: string[] = [];
  if (axisUsesValue(context.xAxis, valueType)) roles.push("X-Axis");
  if (axisUsesValue(context.yAxis, valueType)) roles.push("Y-Axis");
  if (axisUsesValue(context.colorBy, valueType)) roles.push("Color");
  if (axisUsesValue(context.shapeBy, valueType)) roles.push("Shape");
  if (axisUsesValue(sortAxis(context.sortBy), valueType)) roles.push("Sort");
  return roles;
}

function axisUsesValue(axis: AxisOption, valueType: "activity" | "time"): boolean {
  if (valueType === "activity") return axis.type === "activity";
  return isTimeAxis(axis);
}

function sortAxis(sortBy: SortOption | AxisOption): AxisOption {
  return "type" in sortBy ? sortBy : sortBy.field;
}

function formatDetailLabel(row: DetailRow): string {
  if (!row.roles?.length) return row.label;
  return `${row.label} (${row.roles.join(", ")})`;
}

function valueLabel(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "None";
  return String(value);
}

export type { AxisOption, DottedChartViewport, OCEvent, SortOption };
