import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { ChartContainer } from "@/components/ui/chart";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ScanIcon, ZoomIn, ZoomOut } from "lucide-react";
import {
  formatAxisTick,
  makeAxisLabelLookup,
  makeColorScale,
  makeShapeScale,
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
const MIN_BRUSH_POINTS = 10;

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
  const [brushRange, setBrushRange] = useState<BrushRange>({ startIndex: 0, endIndex: 0 });
  const [isZoomApplying, setIsZoomApplying] = useState(false);
  const zoomFrameRef = useRef<number | null>(null);
  const zoomFinishFrameRef = useRef<number | null>(null);
  const effectiveBrushRange = useMemo(
    () => clampBrushRange(brushRange, points.length),
    [brushRange, points.length]
  );
  const visiblePoints = useMemo(
    () => points.slice(effectiveBrushRange.startIndex, effectiveBrushRange.endIndex + 1),
    [effectiveBrushRange, points]
  );
  const colorScale = useMemo(() => makeColorScale(points), [points]);
  const shapeScale = useMemo(() => makeShapeScale(points), [points]);
  const xLabels = useMemo(() => makeAxisLabelLookup(points, "x"), [points]);
  const yLabels = useMemo(() => makeAxisLabelLookup(points, "y"), [points]);
  const xDomain = useMemo(() => getDataDomain(visiblePoints.map((point) => point.chartX)), [visiblePoints]);
  const yTicks = useMemo(() => getUniqueSortedValues(points.map((point) => point.chartY)), [points]);
  const yDomain = useMemo(() => getRowDomain(yTicks), [yTicks]);
  const zoomValue = useMemo(
    () => brushRangeToZoomValue(effectiveBrushRange, points.length),
    [effectiveBrushRange, points.length]
  );

  useEffect(() => {
    setBrushRange({ startIndex: 0, endIndex: Math.max(0, points.length - 1) });
  }, [points]);

  useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current);
      if (zoomFinishFrameRef.current !== null) window.cancelAnimationFrame(zoomFinishFrameRef.current);
    };
  }, []);

  const applyZoomRange = useCallback((nextRange: BrushRange) => {
    if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current);
    if (zoomFinishFrameRef.current !== null) window.cancelAnimationFrame(zoomFinishFrameRef.current);

    setIsZoomApplying(true);
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      setBrushRange(nextRange);
      zoomFinishFrameRef.current = window.requestAnimationFrame(() => {
        setIsZoomApplying(false);
      });
    });
  }, []);

  const handleBrushChange = useCallback(
    (range: { startIndex?: number; endIndex?: number }) => {
      if (!points.length) return;
      applyZoomRange(
        clampBrushRange(
          {
            startIndex: range.startIndex ?? effectiveBrushRange.startIndex,
            endIndex: range.endIndex ?? effectiveBrushRange.endIndex,
          },
          points.length
        )
      );
    },
    [applyZoomRange, effectiveBrushRange, points.length]
  );

  const handleZoomCommit = useCallback(
    (values: number[]) => {
      const nextZoom = values[0] ?? 0;
      applyZoomRange(zoomValueToBrushRange(nextZoom, effectiveBrushRange, points.length));
    },
    [applyZoomRange, effectiveBrushRange, points.length]
  );

  const handleResetViewport = useCallback(() => {
    setBrushRange({ startIndex: 0, endIndex: Math.max(0, points.length - 1) });
  }, [points.length]);

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
          Showing {visiblePoints.length.toLocaleString()} of {data?.total_count.toLocaleString() ?? 0} events
          {data?.sampled ? " (sampled)" : ""}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <span>{data?.outlier_count.toLocaleString() ?? 0} outliers preserved</span>
          <div className="flex items-center gap-2">
            <ZoomOut className="h-4 w-4 text-muted-foreground" />
            <Slider
              key={`dotted-chart-zoom-${zoomValue}`}
              min={0}
              max={100}
              step={1}
              defaultValue={[zoomValue]}
              onValueCommit={handleZoomCommit}
              disabled={points.length <= 1}
              className="w-[120px]"
            />
            <ZoomIn className="h-4 w-4 text-muted-foreground" />
            {isZoomApplying && (
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground"
                aria-label="Applying zoom"
                title="Applying zoom"
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleResetViewport}
              disabled={points.length <= 1 || zoomValue === 0}
              className="h-8 w-8 rounded-full"
              title="Reset dotted chart viewport"
            >
              <ScanIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <ChartContainer
        config={{ events: { label: "Events", color: "var(--chart-1)" } }}
        className="min-h-0 flex-1 rounded-md border bg-background p-2"
      >
        <ScatterChart data={points} margin={{ top: 16, right: 20, bottom: 46, left: 12 }}>
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
            content={
              <DottedChartTooltip
                xAxis={xAxis}
                yAxis={yAxis}
                colorBy={colorBy}
              />
            }
          />
          <Scatter
            name="Events"
            data={visiblePoints}
            isAnimationActive={false}
            shape={(props: any) => {
              const point = props.payload as ChartPoint;
              const color = colorScale.get(point.colorKey) ?? "var(--chart-1)";
              const shape = shapeScale.get(point.shapeKey) ?? "circle";
              return renderPointShape(props.cx, props.cy, color, shape, () => onEventClick?.(point));
            }}
          />
          <Brush
            dataKey="chartX"
            height={24}
            travellerWidth={8}
            startIndex={effectiveBrushRange.startIndex}
            endIndex={effectiveBrushRange.endIndex}
            tickFormatter={(value) => formatXAxisTick(value, xAxis, xLabels)}
            onChange={handleBrushChange}
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

type BrushRange = {
  startIndex: number;
  endIndex: number;
};

function clampBrushRange(range: BrushRange, pointCount: number): BrushRange {
  if (pointCount <= 0) return { startIndex: 0, endIndex: 0 };
  const maxIndex = pointCount - 1;
  const startIndex = Math.max(0, Math.min(maxIndex, Math.floor(range.startIndex)));
  const endIndex = Math.max(startIndex, Math.min(maxIndex, Math.floor(range.endIndex)));
  return { startIndex, endIndex };
}

function brushRangeToZoomValue(range: BrushRange, pointCount: number): number {
  if (pointCount <= 1) return 0;
  const visibleCount = range.endIndex - range.startIndex + 1;
  const minVisible = Math.min(MIN_BRUSH_POINTS, pointCount);
  if (pointCount <= minVisible) return 0;
  const zoom = ((pointCount - visibleCount) / (pointCount - minVisible)) * 100;
  return Math.max(0, Math.min(100, Math.round(zoom)));
}

function zoomValueToBrushRange(zoomValue: number, currentRange: BrushRange, pointCount: number): BrushRange {
  if (pointCount <= 0) return { startIndex: 0, endIndex: 0 };
  if (pointCount === 1) return { startIndex: 0, endIndex: 0 };

  const minVisible = Math.min(MIN_BRUSH_POINTS, pointCount);
  const clampedZoom = Math.max(0, Math.min(100, zoomValue));
  const visibleCount = Math.max(
    minVisible,
    Math.round(pointCount - (clampedZoom / 100) * (pointCount - minVisible))
  );
  const center = (currentRange.startIndex + currentRange.endIndex) / 2;
  const startIndex = Math.round(center - (visibleCount - 1) / 2);
  return clampBrushRange(
    {
      startIndex,
      endIndex: startIndex + visibleCount - 1,
    },
    pointCount
  );
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

function formatAxisValue(axis: AxisOption, value: number | string | null, fallback: string): string {
  const numericValue = Number(value);
  if (isTimeAxis(axis) && Number.isFinite(numericValue)) {
    return formatUnixDateTick(numericValue);
  }
  return fallback;
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
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  xAxis: AxisOption;
  yAxis: AxisOption;
  colorBy: AxisOption;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload as ChartPoint;

  return (
    <div className="max-w-[360px] rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">Activity: {point.activity}</span>
        <span className="text-muted-foreground">activity_id: {point.id}</span>
      </div>
      <div className="grid gap-1 text-muted-foreground">
        <div>
          <span className="text-foreground">{formatAxisLabel(xAxis)} (X-Axis):</span>{" "}
          {formatAxisValue(xAxis, point.x, point.xLabel)}
        </div>
        <div>
          <span className="text-foreground">{formatAxisLabel(yAxis)} (Y-Axis):</span>{" "}
          {formatAxisValue(yAxis, point.y, point.yLabel)}
        </div>
        {colorBy.type !== "none" && (
          <div>
            <span className="text-foreground">{formatAxisLabel(colorBy)} (Color):</span> {valueLabel(point.color_value)}
          </div>
        )}
      </div>
    </div>
  );
}

function valueLabel(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "None";
  return String(value);
}

export type { AxisOption, DottedChartViewport, OCEvent, SortOption };
