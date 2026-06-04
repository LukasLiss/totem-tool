import React, { useMemo } from "react";
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
            tickFormatter={(value) => xLabels.get(Number(value)) ?? formatAxisTick(Number(value))}
            tickMargin={8}
            minTickGap={28}
          />
          <YAxis
            dataKey="chartY"
            name="y"
            type="number"
            tickFormatter={(value) => yLabels.get(Number(value)) ?? formatAxisTick(Number(value))}
            tickMargin={8}
            width={96}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<DottedChartTooltip />} />
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

function DottedChartState({ className, message }: { className?: string; message: string }) {
  return (
    <div className={cn("flex h-[320px] items-center justify-center rounded-md border bg-background p-4", className)}>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function DottedChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload as ChartPoint;

  return (
    <div className="max-w-[360px] rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">{point.activity}</span>
        <span className="text-muted-foreground">{point.id}</span>
      </div>
      <div className="grid gap-1 text-muted-foreground">
        <div>
          <span className="text-foreground">Time:</span> {formatTimestamp(point.timestamp, point.timestamp_unix)}
        </div>
        <div>
          <span className="text-foreground">X:</span> {point.xLabel}
        </div>
        <div>
          <span className="text-foreground">Y:</span> {point.yLabel}
        </div>
        <div>
          <span className="text-foreground">Objects:</span> {objectSummary(point.objects)}
        </div>
      </div>
    </div>
  );
}

export type { AxisOption, DottedChartViewport, OCEvent, SortOption };
