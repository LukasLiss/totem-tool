import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { ChartContainer } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
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
import {
  DottedChartControls,
  type DottedChartConfig,
} from "./dottedChart/DottedChartControls";
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
  showControls?: boolean;
  className?: string;
  onEventClick?: (event: OCEvent) => void;
}

const DEFAULT_X_AXIS: AxisOption = { type: "time" };
const DEFAULT_Y_AXIS: AxisOption = { type: "activity" };
const DEFAULT_COLOR_BY: AxisOption = { type: "activity" };
const DEFAULT_SHAPE_BY: AxisOption = { type: "none" };
const DEFAULT_SORT_BY: AxisOption = { type: "time" };
const MIN_BRUSH_POINTS = 10;
const CHART_MARGIN = { top: 16, right: 20, bottom: 46, left: 12 };
const Y_AXIS_WIDTH = 140;

export default function DottedChart({
  fileId,
  xAxis = DEFAULT_X_AXIS,
  yAxis = DEFAULT_Y_AXIS,
  colorBy = DEFAULT_COLOR_BY,
  shapeBy = DEFAULT_SHAPE_BY,
  sortBy = DEFAULT_SORT_BY,
  maxPoints = 20_000,
  viewport,
  showControls = false,
  className,
  onEventClick,
}: DottedChartProps) {
  const defaultConfig = useMemo<DottedChartConfig>(
    () => ({
      xAxis,
      yAxis,
      colorBy,
      shapeBy,
      sortBy,
      maxPoints,
    }),
    [colorBy, maxPoints, shapeBy, sortBy, xAxis, yAxis]
  );
  const storageKey = fileId ? `oc-dotted-chart-config:${fileId}` : null;
  const [config, setConfig] = useState<DottedChartConfig>(defaultConfig);
  const [loadedConfigKey, setLoadedConfigKey] = useState<string | null>(null);
  const effectiveConfig = showControls ? config : defaultConfig;

  useEffect(() => {
    if (!showControls) {
      setConfig(defaultConfig);
      setLoadedConfigKey(null);
      return;
    }

    if (!storageKey) {
      setConfig(defaultConfig);
      setLoadedConfigKey(null);
      return;
    }

    try {
      const storedConfig = window.localStorage.getItem(storageKey);
      setConfig(storedConfig ? { ...defaultConfig, ...JSON.parse(storedConfig) } : defaultConfig);
    } catch {
      setConfig(defaultConfig);
    }
    setLoadedConfigKey(storageKey);
  }, [defaultConfig, showControls, storageKey]);

  useEffect(() => {
    if (!showControls || !storageKey || loadedConfigKey !== storageKey) return;
    window.localStorage.setItem(storageKey, JSON.stringify(config));
  }, [config, loadedConfigKey, showControls, storageKey]);

  const { data, loading, error } = useDottedChartData({
    fileId,
    xAxis: effectiveConfig.xAxis,
    yAxis: effectiveConfig.yAxis,
    colorBy: effectiveConfig.colorBy,
    shapeBy: effectiveConfig.shapeBy,
    sortBy: effectiveConfig.sortBy,
    maxPoints: effectiveConfig.maxPoints,
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
    <div className={cn("relative flex h-[500px] min-h-[420px] flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          Showing {visiblePoints.length.toLocaleString()} of {data?.total_count.toLocaleString() ?? 0} events
          {data?.sampled ? " (sampled)" : ""}
        </span>
        <span>{data?.outlier_count.toLocaleString() ?? 0} outliers preserved</span>
      </div>

      {showControls && (
        <DottedChartControls
          fileId={fileId}
          config={effectiveConfig}
          onConfigChange={setConfig}
        />
      )}

      <DottedChartZoomControls
        range={effectiveBrushRange}
        points={points}
        xAxis={effectiveConfig.xAxis}
        xLabels={xLabels}
        zoomValue={zoomValue}
        isApplying={isZoomApplying}
        onZoomCommit={handleZoomCommit}
        onReset={handleResetViewport}
        onCommit={applyZoomRange}
      />

      <ChartContainer
        config={{ events: { label: "Events", color: "var(--chart-1)" } }}
        className="min-h-0 flex-1 rounded-md border bg-background p-2"
      >
        <ScatterChart data={points} margin={CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="chartX"
            name="x"
            type="number"
            domain={xDomain}
            tickFormatter={(value) => formatXAxisTick(value, effectiveConfig.xAxis, xLabels)}
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
            width={Y_AXIS_WIDTH}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={
              <DottedChartTooltip
                xAxis={effectiveConfig.xAxis}
                yAxis={effectiveConfig.yAxis}
                colorBy={effectiveConfig.colorBy}
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

function DottedChartZoomControls({
  range,
  points,
  xAxis,
  xLabels,
  zoomValue,
  isApplying,
  onZoomCommit,
  onReset,
  onCommit,
}: {
  range: BrushRange;
  points: ChartPoint[];
  xAxis: AxisOption;
  xLabels: Map<number, string>;
  zoomValue: number;
  isApplying: boolean;
  onZoomCommit: (values: number[]) => void;
  onReset: () => void;
  onCommit: (range: BrushRange) => void;
}) {
  const pointCount = points.length;
  const [draftRange, setDraftRange] = useState(range);
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const effectiveDraftRange = useMemo(
    () => clampBrushRange(draftRange, pointCount),
    [draftRange, pointCount]
  );
  const minStepsBetweenThumbs = Math.max(0, Math.min(MIN_BRUSH_POINTS - 1, pointCount - 1));
  const startPercent = indexToPercent(effectiveDraftRange.startIndex, pointCount);
  const endPercent = indexToPercent(effectiveDraftRange.endIndex, pointCount);
  const startLabelPlacement = getRangeLabelPlacement(startPercent);
  const endLabelPlacement = getRangeLabelPlacement(endPercent);
  const supportsDateBounds = isTimeAxis(xAxis);

  useEffect(() => {
    setDraftRange(range);
    setStartDateInput(formatRangeDateInput(points[range.startIndex], xAxis));
    setEndDateInput(formatRangeDateInput(points[range.endIndex], xAxis));
    setDateError(null);
  }, [points, range, xAxis]);

  const handleRangeChange = useCallback(
    (values: number[]) => {
      setDraftRange(
        clampBrushRange(
          {
            startIndex: values[0] ?? range.startIndex,
            endIndex: values[1] ?? range.endIndex,
          },
          pointCount
        )
      );
    },
    [pointCount, range]
  );

  const handleRangeCommit = useCallback(
    (values: number[]) => {
      const nextRange = clampBrushRange(
        {
          startIndex: values[0] ?? range.startIndex,
          endIndex: values[1] ?? range.endIndex,
        },
        pointCount
      );
      setStartDateInput(formatRangeDateInput(points[nextRange.startIndex], xAxis));
      setEndDateInput(formatRangeDateInput(points[nextRange.endIndex], xAxis));
      setDateError(null);
      onCommit(nextRange);
    },
    [onCommit, pointCount, points, range, xAxis]
  );

  const handleDateSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!supportsDateBounds) {
        setDateError("Date bounds are only available for time-based x axes.");
        return;
      }

      const start = parseDateInput(startDateInput, "start");
      const end = parseDateInput(endDateInput, "end");

      if (start.status === "invalid-format" || end.status === "invalid-format") {
        setDateError("Use mm/dd/yyyy for both date bounds.");
        return;
      }
      if (start.status === "invalid-date" || end.status === "invalid-date") {
        setDateError("Enter a valid calendar date.");
        return;
      }
      if (start.value > end.value) {
        setDateError("Start date must be before end date.");
        return;
      }

      const nextRange = findRangeForDateBounds(points, start.value, end.value);

      if (!nextRange) {
        setDateError("No events found inside those dates.");
        return;
      }

      setDateError(null);
      setDraftRange(nextRange);
      onCommit(nextRange);
    },
    [endDateInput, onCommit, points, startDateInput, supportsDateBounds]
  );

  const handleDateInputChange = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string>>) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        setter(event.target.value);
        setDateError(null);
      },
    []
  );

  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[260px] flex-1 items-center gap-2">
          <ZoomOut className="h-4 w-4 text-muted-foreground" />
          <div className="relative min-w-[140px] flex-1">
            <Slider
              key={`dotted-chart-zoom-${zoomValue}`}
              min={0}
              max={100}
              step={1}
              defaultValue={[zoomValue]}
              onValueCommit={onZoomCommit}
              disabled={pointCount <= 1}
              className="w-full"
            />
            {isApplying && (
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 shadow-sm">
                <ZoomApplyingSpinner />
              </div>
            )}
          </div>
          <ZoomIn className="h-4 w-4 text-muted-foreground" />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onReset}
          disabled={pointCount <= 1 || zoomValue === 0}
          className="h-8 w-8 rounded-full"
          title="Reset dotted chart viewport"
        >
          <ScanIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-start">
        <div className="relative w-full px-1">
          <Slider
            min={0}
            max={Math.max(0, pointCount - 1)}
            step={1}
            minStepsBetweenThumbs={minStepsBetweenThumbs}
            value={[effectiveDraftRange.startIndex, effectiveDraftRange.endIndex]}
            onValueChange={handleRangeChange}
            onValueCommit={handleRangeCommit}
            disabled={pointCount <= 1}
            className="w-full"
          />
          {isApplying && (
            <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 shadow-sm">
              <ZoomApplyingSpinner />
            </div>
          )}
          <div className="relative h-7 text-[11px] text-muted-foreground">
            <span
              className={cn("absolute top-2 whitespace-nowrap", startLabelPlacement.className)}
              style={{ left: `${startLabelPlacement.left}%` }}
            >
              {formatRangePointLabel(points[effectiveDraftRange.startIndex], xAxis, xLabels)}
            </span>
            <span
              className={cn("absolute top-2 whitespace-nowrap", endLabelPlacement.className)}
              style={{ left: `${endLabelPlacement.left}%` }}
            >
              {formatRangePointLabel(points[effectiveDraftRange.endIndex], xAxis, xLabels)}
            </span>
          </div>
        </div>

        <form className="flex flex-wrap items-start gap-2" onSubmit={handleDateSubmit}>
          <Input
            value={startDateInput}
            onChange={handleDateInputChange(setStartDateInput)}
            placeholder="mm/dd/yyyy"
            disabled={!supportsDateBounds || pointCount <= 1}
            className="h-8 w-[116px] text-xs"
            aria-label="Start date"
          />
          <Input
            value={endDateInput}
            onChange={handleDateInputChange(setEndDateInput)}
            placeholder="mm/dd/yyyy"
            disabled={!supportsDateBounds || pointCount <= 1}
            className="h-8 w-[116px] text-xs"
            aria-label="End date"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={!supportsDateBounds || pointCount <= 1}
            className="h-8"
          >
            Apply
          </Button>
          {dateError && <span className="basis-full text-xs text-destructive">{dateError}</span>}
        </form>
      </div>
    </div>
  );
}

function ZoomApplyingSpinner() {
  return (
    <span
      className="block h-4 w-4 animate-spin rounded-full border-2 border-dotted border-muted-foreground/70 border-t-transparent"
      aria-label="Applying zoom"
      title="Applying zoom"
    />
  );
}

function indexToPercent(index: number, pointCount: number): number {
  if (pointCount <= 1) return 0;
  return (index / (pointCount - 1)) * 100;
}

function getRangeLabelPlacement(percent: number): { left: number; className: string } {
  if (percent <= 6) return { left: 0, className: "translate-x-0 text-left" };
  if (percent >= 94) return { left: 100, className: "-translate-x-full text-right" };
  return { left: percent, className: "-translate-x-1/2 text-center" };
}

function formatRangePointLabel(
  point: ChartPoint | undefined,
  axis: AxisOption,
  labels: Map<number, string>
): string {
  if (!point) return "";
  return formatXAxisTick(point.chartX, axis, labels);
}

function formatRangeDateInput(point: ChartPoint | undefined, axis: AxisOption): string {
  if (!point || !isTimeAxis(axis)) return "";
  const date = new Date(toUnixMilliseconds(point.chartX));
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

type ParsedDateInput =
  | { status: "valid"; value: number }
  | { status: "invalid-format" }
  | { status: "invalid-date" };

function parseDateInput(value: string, boundary: "start" | "end"): ParsedDateInput {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return { status: "invalid-format" };

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = boundary === "start"
    ? new Date(year, month - 1, day, 0, 0, 0, 0)
    : new Date(year, month - 1, day, 23, 59, 59, 999);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { status: "invalid-date" };
  }

  return { status: "valid", value: date.getTime() };
}

function findRangeForDateBounds(
  points: ChartPoint[],
  startMilliseconds: number,
  endMilliseconds: number
): BrushRange | null {
  let startIndex: number | null = null;
  let endIndex: number | null = null;

  points.forEach((point, index) => {
    const value = toUnixMilliseconds(point.chartX);
    if (!Number.isFinite(value) || value < startMilliseconds || value > endMilliseconds) return;
    if (startIndex === null) startIndex = index;
    endIndex = index;
  });

  if (startIndex === null || endIndex === null) return null;
  return { startIndex, endIndex };
}

function toUnixMilliseconds(value: number): number {
  return Math.abs(value) >= 1_000_000_000_000 ? value : value * 1000;
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
