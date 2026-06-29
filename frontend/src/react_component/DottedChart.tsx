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
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Map as MapIcon } from "lucide-react";
import {
  colorGroupKey,
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
  type RowOrderOption,
} from "./dottedChart/dottedChartUtils";
import {
  DottedChartControls,
  type DottedChartConfig,
} from "./dottedChart/DottedChartControls";
import { DottedChartMinimap } from "./dottedChart/DottedChartMinimap";
import { useDottedChartData } from "./dottedChart/useDottedChartData";

interface DottedChartProps {
  fileId?: number;
  xAxis?: AxisOption;
  yAxis?: AxisOption;
  colorBy?: AxisOption;
  shapeBy?: AxisOption;
  rowOrder?: RowOrderOption;
  maxPoints?: number;
  viewport?: DottedChartViewport;
  showControls?: boolean;
  showMinimap?: boolean;
  className?: string;
  onEventClick?: (event: OCEvent) => void;
}

const DEFAULT_X_AXIS: AxisOption = { type: "time" };
const DEFAULT_Y_AXIS: AxisOption = { type: "activity" };
const DEFAULT_COLOR_BY: AxisOption = { type: "activity" };
const DEFAULT_SHAPE_BY: AxisOption = { type: "none" };
const DEFAULT_ROW_ORDER: RowOrderOption = "first_occurrence";
const MIN_BRUSH_POINTS = 10;
const MIN_VISIBLE_ROWS = 1;
const CHART_MARGIN = { top: 72, right: 8, bottom: 18, left: 0 };
const Y_AXIS_WIDTH = 118;
const CHART_HEIGHT = 560;
const MAX_Y_TICK_LABEL_LENGTH = 24;
const MAX_VISIBLE_Y_AXIS_LABELS = 20;
const MINIMAP_MAX_POINTS = 2_000;
const EMPTY_EVENTS: OCEvent[] = [];

export default function DottedChart({
  fileId,
  xAxis = DEFAULT_X_AXIS,
  yAxis = DEFAULT_Y_AXIS,
  colorBy = DEFAULT_COLOR_BY,
  shapeBy = DEFAULT_SHAPE_BY,
  rowOrder = DEFAULT_ROW_ORDER,
  maxPoints = 20_000,
  viewport,
  showControls = false,
  showMinimap = true,
  className,
  onEventClick,
}: DottedChartProps) {
  const defaultConfig = useMemo<DottedChartConfig>(
    () => ({
      xAxis,
      yAxis,
      colorBy,
      shapeBy,
      rowOrder,
      maxPoints,
    }),
    [colorBy, maxPoints, rowOrder, shapeBy, xAxis, yAxis]
  );
  const [config, setConfig] = useState<DottedChartConfig>(defaultConfig);
  const effectiveConfig = showControls ? config : defaultConfig;
  const [requestedViewport, setRequestedViewport] = useState<DottedChartViewport | undefined>(viewport);
  const [sampleSeed, setSampleSeed] = useState(0);
  const [controlBrushRange, setControlBrushRange] = useState<BrushRange>({ startIndex: 0, endIndex: 0 });
  const [controlYBrushRange, setControlYBrushRange] = useState<BrushRange>({ startIndex: 0, endIndex: 0 });
  const [framePoints, setFramePoints] = useState<ChartPoint[]>([]);
  const [frameYTicks, setFrameYTicks] = useState<number[]>([]);
  const previousPointCountRef = useRef(0);
  const previousRowCountRef = useRef(0);
  const previousFramePointCountRef = useRef(0);
  const previousFrameRowCountRef = useRef(0);
  const resetBrushOnNextPointsRef = useRef(false);
  const resetYBrushOnNextRowsRef = useRef(false);
  const colorKeysRef = useRef<string[]>([]);
  const colorByKeyRef = useRef("");
  const colorEventsRef = useRef<OCEvent[] | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const chartInteractionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setConfig(defaultConfig);
  }, [defaultConfig]);

  useEffect(() => {
    setRequestedViewport(viewport);
    setSampleSeed(0);
    setFramePoints([]);
    setFrameYTicks([]);
    setControlBrushRange({ startIndex: 0, endIndex: 0 });
    setControlYBrushRange({ startIndex: 0, endIndex: 0 });
    previousPointCountRef.current = 0;
    previousRowCountRef.current = 0;
    previousFramePointCountRef.current = 0;
    previousFrameRowCountRef.current = 0;
    resetBrushOnNextPointsRef.current = false;
    resetYBrushOnNextRowsRef.current = false;
  }, [fileId, viewport]);

  const { data, loading, error } = useDottedChartData({
    fileId,
    xAxis: effectiveConfig.xAxis,
    yAxis: effectiveConfig.yAxis,
    colorBy: effectiveConfig.colorBy,
    shapeBy: effectiveConfig.shapeBy,
    rowOrder: effectiveConfig.rowOrder,
    maxPoints: effectiveConfig.maxPoints,
    viewport: requestedViewport,
    sampleSeed,
  });

  const events = data?.events ?? EMPTY_EVENTS;
  const points = useMemo(() => toChartPoints(events), [events]);
  const [brushRange, setBrushRange] = useState<BrushRange>({ startIndex: 0, endIndex: 0 });
  const [isZoomApplying, setIsZoomApplying] = useState(false);
  const zoomFrameRef = useRef<number | null>(null);
  const zoomFinishFrameRef = useRef<number | null>(null);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const effectiveBrushRange = useMemo(
    () => clampBrushRange(brushRange, points.length),
    [brushRange, points.length]
  );
  const visiblePoints = useMemo(
    () => points.slice(effectiveBrushRange.startIndex, effectiveBrushRange.endIndex + 1),
    [effectiveBrushRange, points]
  );
  const shapeScale = useMemo(() => makeShapeScale(points), [points]);
  const xLabels = useMemo(() => makeAxisLabelLookup(points, "x"), [points]);
  const yLabels = useMemo(() => makeAxisLabelLookup(points, "y"), [points]);
  const yTicks = useMemo(
    () => orderDisplayedYTicks(points, effectiveConfig.rowOrder),
    [effectiveConfig.rowOrder, points]
  );
  const [yBrushRange, setYBrushRange] = useState<BrushRange>({ startIndex: 0, endIndex: 0 });
  const effectiveYBrushRange = useMemo(
    () => clampBrushRange(yBrushRange, yTicks.length),
    [yBrushRange, yTicks.length]
  );
  const visibleYTicks = useMemo(
    () => yTicks.slice(effectiveYBrushRange.startIndex, effectiveYBrushRange.endIndex + 1),
    [effectiveYBrushRange, yTicks]
  );
  const visibleYTickSet = useMemo(() => new Set(visibleYTicks), [visibleYTicks]);
  const visiblePointsByAxes = useMemo(
    () => visiblePoints.filter((point) => visibleYTickSet.has(point.chartY)),
    [visiblePoints, visibleYTickSet]
  );
  const displayedYTicks = visibleYTicks;
  const displayedYIndexByTick = useMemo(
    () => new Map(displayedYTicks.map((tick, index) => [tick, index + 1])),
    [displayedYTicks]
  );
  const displayedYLabels = useMemo(
    () =>
      new Map(
        displayedYTicks.map((tick, index) => [
          index + 1,
          yLabels.get(tick) ?? formatAxisTick(tick),
        ])
      ),
    [displayedYTicks, yLabels]
  );
  const displayedPoints = useMemo(
    () =>
      visiblePointsByAxes.map((point) => ({
        ...point,
        chartY: displayedYIndexByTick.get(point.chartY) ?? point.chartY,
      })),
    [displayedYIndexByTick, visiblePointsByAxes]
  );
  const displayedYAxisTicks = useMemo(
    () => displayedYTicks.map((_, index) => index + 1),
    [displayedYTicks]
  );
  const displayedYAxisLabelTicks = useMemo(
    () => sampleAxisTicks(displayedYAxisTicks, MAX_VISIBLE_Y_AXIS_LABELS),
    [displayedYAxisTicks]
  );
  const xDomain = useMemo(() => getDataDomain(displayedPoints.map((point) => point.chartX)), [displayedPoints]);
  const yDomain = useMemo(() => getRowDomain(displayedYAxisTicks), [displayedYAxisTicks]);
  const datasetTotalCount = data?.dataset_total_count ?? data?.total_count ?? 0;
  const effectiveFramePoints = framePoints.length ? framePoints : points;
  const effectiveFrameYTicks = frameYTicks.length ? frameYTicks : yTicks;
  const minimapPoints = useMemo(
    () => sampleMinimapPoints(effectiveFramePoints, MINIMAP_MAX_POINTS),
    [effectiveFramePoints]
  );
  const colorByKey = useMemo(() => axisOptionKey(effectiveConfig.colorBy), [effectiveConfig.colorBy]);
  const colorGrouping = useMemo(() => {
    const colorByChanged = colorByKeyRef.current !== colorByKey;
    const eventsChanged = colorEventsRef.current !== events;

    if (colorByChanged) {
      if (!eventsChanged && colorEventsRef.current !== null) {
        return makeColorScale(effectiveFramePoints);
      }

      colorByKeyRef.current = colorByKey;
      colorKeysRef.current = [];
    }

    const nextColorGrouping = makeColorScale(effectiveFramePoints, colorKeysRef.current);
    colorKeysRef.current = nextColorGrouping.keys;
    colorEventsRef.current = events;
    return nextColorGrouping;
  }, [colorByKey, effectiveFramePoints, events]);
  const colorScale = colorGrouping.scale;
  const colorKeys = colorGrouping.keys;
  const colorLegendEntries = useMemo(
    () => buildColorLegendEntries(effectiveFramePoints, colorScale, colorKeys),
    [colorKeys, colorScale, effectiveFramePoints]
  );
  const frameXLabels = useMemo(() => makeAxisLabelLookup(effectiveFramePoints, "x"), [effectiveFramePoints]);
  const frameYLabels = useMemo(() => makeAxisLabelLookup(effectiveFramePoints, "y"), [effectiveFramePoints]);
  const effectiveControlBrushRange = useMemo(
    () => clampBrushRange(controlBrushRange, effectiveFramePoints.length),
    [controlBrushRange, effectiveFramePoints.length]
  );
  const effectiveControlYBrushRange = useMemo(
    () => clampBrushRange(controlYBrushRange, effectiveFrameYTicks.length),
    [controlYBrushRange, effectiveFrameYTicks.length]
  );
  const isViewportZoomed = Boolean(requestedViewport) ||
    !isFullRange(effectiveControlBrushRange, effectiveFramePoints.length) ||
    !isFullRange(effectiveControlYBrushRange, effectiveFrameYTicks.length);

  useEffect(() => {
    const previousLength = previousPointCountRef.current;
    const shouldReset = resetBrushOnNextPointsRef.current;
    setBrushRange((current) =>
      previousLength === 0 || shouldReset
        ? fullBrushRange(points.length)
        : clampBrushRange(current, points.length)
    );
    resetBrushOnNextPointsRef.current = false;
    previousPointCountRef.current = points.length;
  }, [points]);

  useEffect(() => {
    const previousLength = previousRowCountRef.current;
    const shouldReset = resetYBrushOnNextRowsRef.current;
    setYBrushRange((current) =>
      previousLength === 0 || shouldReset || isFullRange(current, previousLength)
        ? fullBrushRange(yTicks.length)
        : clampBrushRange(current, yTicks.length)
    );
    resetYBrushOnNextRowsRef.current = false;
    previousRowCountRef.current = yTicks.length;
  }, [yTicks.length]);

  useEffect(() => {
    if (requestedViewport || !points.length) return;
    const previousLength = previousFramePointCountRef.current;
    setFramePoints(points);
    setControlBrushRange((current) =>
      previousLength === 0
        ? fullBrushRange(points.length)
        : clampBrushRange(current, points.length)
    );
    previousFramePointCountRef.current = points.length;
  }, [points, requestedViewport]);

  useEffect(() => {
    if (requestedViewport || !yTicks.length) return;
    const previousLength = previousFrameRowCountRef.current;
    setFrameYTicks(yTicks);
    setControlYBrushRange((current) =>
      previousLength === 0 || isFullRange(current, previousLength)
        ? fullBrushRange(yTicks.length)
        : clampBrushRange(current, yTicks.length)
    );
    previousFrameRowCountRef.current = yTicks.length;
  }, [requestedViewport, yTicks]);

  useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current);
      if (zoomFinishFrameRef.current !== null) window.cancelAnimationFrame(zoomFinishFrameRef.current);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

  const applyRanges = useCallback((nextXRange: BrushRange, nextYRange: BrushRange) => {
    if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current);
    if (zoomFinishFrameRef.current !== null) window.cancelAnimationFrame(zoomFinishFrameRef.current);

    setIsZoomApplying(true);
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      setBrushRange(nextXRange);
      setYBrushRange(nextYRange);
      zoomFinishFrameRef.current = window.requestAnimationFrame(() => {
        setIsZoomApplying(false);
      });
    });
  }, []);

  const handleResample = useCallback(() => {
    const nextViewport = viewportFromFrameSelection(
      effectiveFramePoints,
      effectiveFrameYTicks,
      effectiveControlBrushRange,
      effectiveControlYBrushRange
    );
    if (!nextViewport) return;
    resetBrushOnNextPointsRef.current = true;
    resetYBrushOnNextRowsRef.current = true;
    setRequestedViewport(nextViewport);
    setSampleSeed((current) => current + 1);
  }, [effectiveControlBrushRange, effectiveControlYBrushRange, effectiveFramePoints, effectiveFrameYTicks]);

  const handleRangeApply = useCallback(
    (nextXRange: BrushRange, nextYRange: BrushRange) => {
      setControlBrushRange(nextXRange);
      setControlYBrushRange(nextYRange);

      if (!requestedViewport) {
        applyRanges(nextXRange, nextYRange);
        return;
      }

      const nextViewport = viewportFromFrameSelection(
        effectiveFramePoints,
        effectiveFrameYTicks,
        nextXRange,
        nextYRange
      );
      if (!nextViewport) return;
      resetBrushOnNextPointsRef.current = true;
      resetYBrushOnNextRowsRef.current = true;
      setRequestedViewport(nextViewport);
      setSampleSeed((current) => current + 1);
    },
    [
      applyRanges,
      effectiveFramePoints,
      effectiveFrameYTicks,
      requestedViewport,
    ]
  );
  const handleChartMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const point = chartPointFromMousePosition(event, chartWrapperRef.current, xDomain, yDomain);
    if (!point) return;

    const nextSelection = {
      startX: point.chartX,
      endX: point.chartX,
      startY: point.chartY,
      endY: point.chartY,
      startClientX: point.clientX,
      endClientX: point.clientX,
      startClientY: point.clientY,
      endClientY: point.clientY,
      isDragging: true,
    };
    dragSelectionRef.current = nextSelection;
    setChartInteractionEnabled(chartInteractionRef.current, false);
    updateDragOverlay(dragOverlayRef.current, nextSelection);
  }, [xDomain, yDomain]);
  const handleChartMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const currentSelection = dragSelectionRef.current;
    if (!currentSelection?.isDragging) return;
    event.preventDefault();
    const point = chartPointFromMousePosition(event, chartWrapperRef.current, xDomain, yDomain);
    if (!point) return;

    dragSelectionRef.current = {
      ...currentSelection,
      endX: point.chartX,
      endY: point.chartY,
      endClientX: point.clientX,
      endClientY: point.clientY,
    };
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      updateDragOverlay(dragOverlayRef.current, dragSelectionRef.current);
    });
  }, [xDomain, yDomain]);
  const handleChartMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const releasePoint = chartPointFromMousePosition(event, chartWrapperRef.current, xDomain, yDomain);
    const activeSelection = dragSelectionRef.current;
    const currentSelection = releasePoint && activeSelection
      ? {
          ...activeSelection,
          endX: releasePoint.chartX,
          endY: releasePoint.chartY,
          endClientX: releasePoint.clientX,
          endClientY: releasePoint.clientY,
        }
      : activeSelection;
    dragSelectionRef.current = null;
    setChartInteractionEnabled(chartInteractionRef.current, true);
    hideDragOverlay(dragOverlayRef.current);
    if (!currentSelection?.isDragging) return;
    if (Math.abs(currentSelection.startClientX - currentSelection.endClientX) < 6) return;
    if (Math.abs(currentSelection.startClientY - currentSelection.endClientY) < 6) return;

    const xRange = brushRangeForChartXBounds(effectiveFramePoints, currentSelection);
    const yRange = brushRangeForDisplayedYBounds(
      effectiveFrameYTicks,
      displayedYTicks,
      currentSelection,
      getChartPlotBounds(chartWrapperRef.current)
    );
    if (!xRange || !yRange) return;
    if (
      xRange.startIndex === effectiveControlBrushRange.startIndex &&
      xRange.endIndex === effectiveControlBrushRange.endIndex &&
      yRange.startIndex === effectiveControlYBrushRange.startIndex &&
      yRange.endIndex === effectiveControlYBrushRange.endIndex
    ) {
      return;
    }

    handleRangeApply(xRange, yRange);
  }, [
    displayedYTicks,
    effectiveControlBrushRange,
    effectiveControlYBrushRange,
    effectiveFramePoints,
    effectiveFrameYTicks,
    handleRangeApply,
    xDomain,
    yDomain,
  ]);
  const handleChartMouseLeave = useCallback(() => {
    dragSelectionRef.current = null;
    setChartInteractionEnabled(chartInteractionRef.current, true);
    hideDragOverlay(dragOverlayRef.current);
  }, []);

  const handleResetViewport = useCallback(() => {
    setBrushRange({ startIndex: 0, endIndex: Math.max(0, points.length - 1) });
    setYBrushRange({ startIndex: 0, endIndex: Math.max(0, yTicks.length - 1) });
    setControlBrushRange({ startIndex: 0, endIndex: Math.max(0, effectiveFramePoints.length - 1) });
    setControlYBrushRange({ startIndex: 0, endIndex: Math.max(0, effectiveFrameYTicks.length - 1) });
    if (requestedViewport) {
      resetBrushOnNextPointsRef.current = true;
      resetYBrushOnNextRowsRef.current = true;
      setRequestedViewport(viewport);
      setSampleSeed((current) => current + 1);
    }
  }, [effectiveFramePoints.length, effectiveFrameYTicks.length, points.length, requestedViewport, viewport, yTicks.length]);

  const handleConfigChange = useCallback(
    (nextConfig: DottedChartConfig) => {
      const rowOrderChanged = nextConfig.rowOrder !== effectiveConfig.rowOrder;
      const hasZoomedFrame =
        !isFullRange(effectiveControlBrushRange, effectiveFramePoints.length) ||
        !isFullRange(effectiveControlYBrushRange, effectiveFrameYTicks.length);

      if (rowOrderChanged && hasZoomedFrame) {
        const nextViewport = viewportFromFrameSelection(
          effectiveFramePoints,
          effectiveFrameYTicks,
          effectiveControlBrushRange,
          effectiveControlYBrushRange
        );
        if (nextViewport) {
          resetBrushOnNextPointsRef.current = true;
          resetYBrushOnNextRowsRef.current = true;
          setRequestedViewport(nextViewport);
          setSampleSeed((current) => current + 1);
        }
      }

      setConfig(nextConfig);
    },
    [
      effectiveConfig.rowOrder,
      effectiveControlBrushRange,
      effectiveControlYBrushRange,
      effectiveFramePoints,
      effectiveFrameYTicks,
    ]
  );

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
    <div className={cn("relative flex min-h-[500px] flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Showing {displayedPoints.length.toLocaleString()} of {datasetTotalCount.toLocaleString()} events
            {data?.sampled ? " (sampled)" : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResample}
            disabled={loading || effectiveFramePoints.length === 0}
            className="h-7 px-2 text-xs"
          >
            Resample
          </Button>
        </div>
        <span>{data?.outlier_count.toLocaleString() ?? 0} outliers preserved</span>
      </div>

      {showControls && (
        <DottedChartControls
          fileId={fileId}
          config={effectiveConfig}
          onConfigChange={handleConfigChange}
        />
      )}

      <DottedChartZoomControls
        xRange={effectiveControlBrushRange}
        yRange={effectiveControlYBrushRange}
        points={effectiveFramePoints}
        yTicks={effectiveFrameYTicks}
        xAxis={effectiveConfig.xAxis}
        yAxis={effectiveConfig.yAxis}
        xLabels={frameXLabels}
        yLabels={frameYLabels}
        isApplying={isZoomApplying}
        isZoomed={isViewportZoomed}
        onReset={handleResetViewport}
        onApply={handleRangeApply}
      />

      <div
        ref={chartWrapperRef}
        className="relative shrink-0 select-none"
        onMouseDown={handleChartMouseDown}
        onMouseMove={handleChartMouseMove}
        onMouseUp={handleChartMouseUp}
        onMouseLeave={handleChartMouseLeave}
      >
        <div ref={chartInteractionRef}>
          <ChartContainer
            config={{ events: { label: "Events", color: "var(--chart-1)" } }}
            className="aspect-auto shrink-0 rounded-md border bg-background p-1"
            style={{ height: CHART_HEIGHT }}
          >
            <ScatterChart data={displayedPoints} margin={CHART_MARGIN}>
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
                ticks={displayedYAxisLabelTicks}
                interval={0}
                allowDecimals={false}
                tick={(props) => <DottedChartYAxisTick {...props} labels={displayedYLabels} />}
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
                data={displayedPoints}
                isAnimationActive={false}
                shape={(props: any) => {
                  const point = props.payload as ChartPoint;
                  const color = colorScale.get(colorGroupKey(point.colorKey, colorKeys)) ?? "var(--chart-1)";
                  const shape = shapeScale.get(point.shapeKey) ?? "circle";
                  return renderPointShape(props.cx, props.cy, color, shape, () => onEventClick?.(point));
                }}
              />
            </ScatterChart>
          </ChartContainer>
        </div>
        <div
          ref={dragOverlayRef}
          className="pointer-events-none fixed z-20 hidden border border-ring bg-ring/10"
        />
        {showMinimap && (
          <DottedChartMinimapOverlay
            points={minimapPoints}
            framePoints={effectiveFramePoints}
            yTicks={effectiveFrameYTicks}
            colorScale={colorScale}
            colorKeys={colorKeys}
            xRange={effectiveControlBrushRange}
            yRange={effectiveControlYBrushRange}
            onRangeChange={handleRangeApply}
          />
        )}
      </div>

      {effectiveConfig.colorBy.type !== "none" && colorLegendEntries.length > 0 && (
        <DottedChartColorLegend
          label={formatAxisLabel(effectiveConfig.colorBy)}
          entries={colorLegendEntries}
        />
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 text-sm text-muted-foreground">
          Loading dotted chart...
        </div>
      )}
    </div>
  );
}

const DottedChartMinimapOverlay = React.memo(function DottedChartMinimapOverlay({
  points,
  framePoints,
  yTicks,
  colorScale,
  colorKeys,
  xRange,
  yRange,
  onRangeChange,
}: {
  points: ChartPoint[];
  framePoints: ChartPoint[];
  yTicks: number[];
  colorScale: Map<string, string>;
  colorKeys: string[];
  xRange: BrushRange;
  yRange: BrushRange;
  onRangeChange: (xRange: BrushRange, yRange: BrushRange) => void;
}) {
  const [showMinimap, setShowMinimap] = useState(true);

  return (
    <div
      className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1.5"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 rounded-full bg-background/90 shadow-sm"
        onClick={() => setShowMinimap((current) => !current)}
        title={showMinimap ? "Hide minimap" : "Show minimap"}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <MapIcon className="h-4 w-4" />
          {showMinimap && (
            <span className="absolute h-0.5 w-5 rotate-45 rounded-full bg-current" />
          )}
        </span>
      </Button>
      <div className={cn(!showMinimap && "hidden")}>
        <DottedChartMinimap
          points={points}
          framePoints={framePoints}
          yTicks={yTicks}
          colorScale={colorScale}
          colorKeys={colorKeys}
          xRange={xRange}
          yRange={yRange}
          onRangeChange={onRangeChange}
        />
      </div>
    </div>
  );
});

function DottedChartZoomControls({
  xRange,
  yRange,
  points,
  yTicks,
  xAxis,
  yAxis,
  xLabels,
  yLabels,
  isApplying,
  isZoomed,
  onReset,
  onApply,
}: {
  xRange: BrushRange;
  yRange: BrushRange;
  points: ChartPoint[];
  yTicks: number[];
  xAxis: AxisOption;
  yAxis: AxisOption;
  xLabels: Map<number, string>;
  yLabels: Map<number, string>;
  isApplying: boolean;
  isZoomed: boolean;
  onReset: () => void;
  onApply: (xRange: BrushRange, yRange: BrushRange) => void;
}) {
  const pointCount = points.length;
  const rowCount = yTicks.length;
  const [draftXRange, setDraftXRange] = useState(xRange);
  const [draftYRange, setDraftYRange] = useState(yRange);
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const effectiveDraftXRange = useMemo(
    () => clampBrushRange(draftXRange, pointCount),
    [draftXRange, pointCount]
  );
  const effectiveDraftYRange = useMemo(
    () => clampBrushRange(draftYRange, rowCount),
    [draftYRange, rowCount]
  );
  const minStepsBetweenThumbs = Math.max(0, Math.min(MIN_BRUSH_POINTS - 1, pointCount - 1));
  const minRowStepsBetweenThumbs = Math.max(0, Math.min(MIN_VISIBLE_ROWS - 1, rowCount - 1));
  const startPercent = indexToPercent(effectiveDraftXRange.startIndex, pointCount);
  const endPercent = indexToPercent(effectiveDraftXRange.endIndex, pointCount);
  const startLabelPlacement = getRangeLabelPlacement(startPercent);
  const endLabelPlacement = getRangeLabelPlacement(endPercent);
  const supportsDateBounds = isTimeAxis(xAxis);
  const yStartPercent = indexToPercent(effectiveDraftYRange.startIndex, rowCount);
  const yEndPercent = indexToPercent(effectiveDraftYRange.endIndex, rowCount);
  const yStartLabelPlacement = getRangeLabelPlacement(yStartPercent);
  const yEndLabelPlacement = getRangeLabelPlacement(yEndPercent);
  const isDraftZoomed =
    !isFullRange(effectiveDraftXRange, pointCount) ||
    !isFullRange(effectiveDraftYRange, rowCount);
  const canReset = isZoomed || isDraftZoomed;

  useEffect(() => {
    setDraftXRange(xRange);
    setStartDateInput(formatRangeDateInput(points[xRange.startIndex], xAxis));
    setEndDateInput(formatRangeDateInput(points[xRange.endIndex], xAxis));
    setDateError(null);
  }, [points, xRange, xAxis]);

  useEffect(() => {
    setDraftYRange(yRange);
  }, [yRange]);

  const handleXRangeChange = useCallback(
    (values: number[]) => {
      const nextRange = clampBrushRange(
        {
          startIndex: values[0] ?? xRange.startIndex,
          endIndex: values[1] ?? xRange.endIndex,
        },
        pointCount
      );
      setDraftXRange(nextRange);
      setStartDateInput(formatRangeDateInput(points[nextRange.startIndex], xAxis));
      setEndDateInput(formatRangeDateInput(points[nextRange.endIndex], xAxis));
      setDateError(null);
    },
    [pointCount, points, xRange, xAxis]
  );

  const handleYRangeChange = useCallback(
    (values: number[]) => {
      setDraftYRange(
        clampBrushRange(
          {
            startIndex: values[0] ?? yRange.startIndex,
            endIndex: values[1] ?? yRange.endIndex,
          },
          rowCount
        )
      );
    },
    [rowCount, yRange]
  );

  const handleApplySubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      let nextXRange = effectiveDraftXRange;

      if (supportsDateBounds) {
        const start = parseDateInput(startDateInput, "start");
        const end = parseDateInput(endDateInput, "end");

        if (start.status === "invalid-format" || end.status === "invalid-format") {
          setDateError("Use dd/mm/yyyy for both date bounds.");
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

        const dateRange = findRangeForDateBounds(points, start.value, end.value);

        if (!dateRange) {
          setDateError("No events found inside those dates.");
          return;
        }

        nextXRange = dateRange;
      }

      setDateError(null);
      setDraftXRange(nextXRange);
      onApply(nextXRange, effectiveDraftYRange);
    },
    [
      effectiveDraftXRange,
      effectiveDraftYRange,
      endDateInput,
      onApply,
      points,
      startDateInput,
      supportsDateBounds,
    ]
  );

  const handleDateInputChange = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string>>) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        setter(event.target.value);
        setDateError(null);
      },
    []
  );

  const handleResetZoom = useCallback(() => {
    const nextXRange = fullBrushRange(pointCount);
    const nextYRange = fullBrushRange(rowCount);
    setDraftXRange(nextXRange);
    setDraftYRange(nextYRange);
    setStartDateInput(formatRangeDateInput(points[nextXRange.startIndex], xAxis));
    setEndDateInput(formatRangeDateInput(points[nextXRange.endIndex], xAxis));
    setDateError(null);
    onReset();
  }, [onReset, pointCount, points, rowCount, xAxis]);

  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="relative min-w-0 flex-1 px-1">
          <Label className="mb-2 block text-xs text-muted-foreground">{formatAxisLabel(yAxis)}</Label>
          <Slider
            min={0}
            max={Math.max(0, rowCount - 1)}
            step={1}
            minStepsBetweenThumbs={minRowStepsBetweenThumbs}
            value={[effectiveDraftYRange.startIndex, effectiveDraftYRange.endIndex]}
            onValueChange={handleYRangeChange}
            disabled={rowCount <= 1}
            className="w-full"
          />
          {isApplying && (
            <div className="pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 shadow-sm">
              <ZoomApplyingSpinner />
            </div>
          )}
          <div className="relative h-7 text-[11px] text-muted-foreground">
            <span
              className={cn("absolute top-2 max-w-[45%] truncate whitespace-nowrap", yStartLabelPlacement.className)}
              style={{ left: `${yStartLabelPlacement.left}%` }}
              title={formatYAxisRangeLabel(yTicks[effectiveDraftYRange.startIndex], yLabels)}
            >
              {formatYAxisRangeLabel(yTicks[effectiveDraftYRange.startIndex], yLabels)}
            </span>
            <span
              className={cn("absolute top-2 max-w-[45%] truncate whitespace-nowrap", yEndLabelPlacement.className)}
              style={{ left: `${yEndLabelPlacement.left}%` }}
              title={formatYAxisRangeLabel(yTicks[effectiveDraftYRange.endIndex], yLabels)}
            >
              {formatYAxisRangeLabel(yTicks[effectiveDraftYRange.endIndex], yLabels)}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleResetZoom}
          disabled={!canReset || (pointCount <= 1 && rowCount <= 1)}
          className="mt-5 h-8 shrink-0"
        >
          Reset
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-start">
        <div className="relative w-full px-1">
          <Label className="mb-2 block text-xs text-muted-foreground">{formatAxisLabel(xAxis)}</Label>
          <Slider
            min={0}
            max={Math.max(0, pointCount - 1)}
            step={1}
            minStepsBetweenThumbs={minStepsBetweenThumbs}
            value={[effectiveDraftXRange.startIndex, effectiveDraftXRange.endIndex]}
            onValueChange={handleXRangeChange}
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
              {formatRangePointLabel(points[effectiveDraftXRange.startIndex], xAxis, xLabels)}
            </span>
            <span
              className={cn("absolute top-2 whitespace-nowrap", endLabelPlacement.className)}
              style={{ left: `${endLabelPlacement.left}%` }}
            >
              {formatRangePointLabel(points[effectiveDraftXRange.endIndex], xAxis, xLabels)}
            </span>
          </div>
        </div>

        <form className="flex flex-wrap items-start gap-2" onSubmit={handleApplySubmit}>
          <Input
            value={startDateInput}
            onChange={handleDateInputChange(setStartDateInput)}
            placeholder="dd/mm/yyyy"
            disabled={!supportsDateBounds || pointCount <= 1}
            className="h-8 w-[116px] text-xs"
            aria-label="Start date"
          />
          <Input
            value={endDateInput}
            onChange={handleDateInputChange(setEndDateInput)}
            placeholder="dd/mm/yyyy"
            disabled={!supportsDateBounds || pointCount <= 1}
            className="h-8 w-[116px] text-xs"
            aria-label="End date"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={pointCount <= 1 && rowCount <= 1}
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

function DottedChartColorLegend({
  label,
  entries,
}: {
  label: string;
  entries: ColorLegendEntry[];
}) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Color: {label}
      </div>
      <div className="flex max-h-24 flex-wrap gap-x-4 gap-y-2 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div key={entry.value} className="flex min-w-0 items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border bg-transparent"
              style={{ borderColor: entry.color }}
              aria-hidden="true"
            />
            <span className="max-w-[180px] truncate text-muted-foreground" title={entry.value}>
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type ColorLegendEntry = {
  value: string;
  color: string;
};

function buildColorLegendEntries(
  points: ChartPoint[],
  colorScale: Map<string, string>,
  colorKeys: string[]
): ColorLegendEntry[] {
  const visibleKeys = new Set(points.map((point) => colorGroupKey(point.colorKey, colorKeys)));

  return Array.from(colorScale.entries())
    .filter(([value]) => visibleKeys.has(value))
    .map(([value, color]) => ({ value, color }));
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

function formatYAxisRangeLabel(value: number | undefined, labels: Map<number, string>): string {
  if (value === undefined) return "";
  return labels.get(value) ?? formatAxisTick(value);
}

function formatRangeDateInput(point: ChartPoint | undefined, axis: AxisOption): string {
  if (!point || !isTimeAxis(axis)) return "";
  const date = new Date(toUnixMilliseconds(point.chartX));
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

type ParsedDateInput =
  | { status: "valid"; value: number }
  | { status: "invalid-format" }
  | { status: "invalid-date" };

function parseDateInput(value: string, boundary: "start" | "end"): ParsedDateInput {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return { status: "invalid-format" };

  const day = Number(match[1]);
  const month = Number(match[2]);
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

function chartPointFromMousePosition(
  event: React.MouseEvent<HTMLElement>,
  wrapper: HTMLDivElement | null,
  xDomain: [number, number],
  yDomain: [number, number]
): DragPoint | null {
  const plotBounds = getChartPlotBounds(wrapper);
  if (!plotBounds) return null;

  const clientX = clampNumber(event.clientX, plotBounds.left, plotBounds.right);
  const clientY = clampNumber(event.clientY, plotBounds.top, plotBounds.bottom);
  const xPercent = (clientX - plotBounds.left) / (plotBounds.right - plotBounds.left);
  const yPercent = (clientY - plotBounds.top) / (plotBounds.bottom - plotBounds.top);

  return {
    chartX: xDomain[0] + xPercent * (xDomain[1] - xDomain[0]),
    chartY: yDomain[1] - yPercent * (yDomain[1] - yDomain[0]),
    clientX,
    clientY,
  };
}

function getChartPlotBounds(wrapper: HTMLDivElement | null): PlotBounds | null {
  const svg = wrapper?.querySelector("svg");
  if (!wrapper || !svg) return null;

  const gridBounds = getRenderedGridBounds(wrapper, svg);
  if (gridBounds) return gridBounds;

  const wrapperRect = wrapper.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const left = svgRect.left + Y_AXIS_WIDTH + CHART_MARGIN.left;
  const right = svgRect.right - CHART_MARGIN.right;
  const top = svgRect.top + CHART_MARGIN.top;
  const bottom = svgRect.bottom - CHART_MARGIN.bottom;

  if (right <= left || bottom <= top) return null;
  return {
    left: clampNumber(left, wrapperRect.left, wrapperRect.right),
    right: clampNumber(right, wrapperRect.left, wrapperRect.right),
    top: clampNumber(top, wrapperRect.top, wrapperRect.bottom),
    bottom: clampNumber(bottom, wrapperRect.top, wrapperRect.bottom),
  };
}

function getRenderedGridBounds(wrapper: HTMLDivElement, svg: SVGSVGElement): PlotBounds | null {
  const gridLines = Array.from(
    wrapper.querySelectorAll<SVGLineElement>(
      ".recharts-cartesian-grid-horizontal line, .recharts-cartesian-grid-vertical line"
    )
  );
  if (!gridLines.length) return null;

  const points = gridLines.flatMap((line) => {
    const x1 = Number(line.getAttribute("x1"));
    const y1 = Number(line.getAttribute("y1"));
    const x2 = Number(line.getAttribute("x2"));
    const y2 = Number(line.getAttribute("y2"));
    if (![x1, y1, x2, y2].every(Number.isFinite)) return [];
    return [svgPointToClient(svg, x1, y1), svgPointToClient(svg, x2, y2)];
  });
  if (!points.length) return null;

  const wrapperRect = wrapper.getBoundingClientRect();
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));

  if (right <= left || bottom <= top) return null;
  return {
    left: clampNumber(left, wrapperRect.left, wrapperRect.right),
    right: clampNumber(right, wrapperRect.left, wrapperRect.right),
    top: clampNumber(top, wrapperRect.top, wrapperRect.bottom),
    bottom: clampNumber(bottom, wrapperRect.top, wrapperRect.bottom),
  };
}

function svgPointToClient(svg: SVGSVGElement, x: number, y: number): { x: number; y: number } {
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const screenPoint = point.matrixTransform(svg.getScreenCTM() ?? new DOMMatrix());
  return { x: screenPoint.x, y: screenPoint.y };
}

function updateDragOverlay(overlay: HTMLDivElement | null, selection: DragSelection | null) {
  if (!overlay || !selection?.isDragging) return;
  const left = Math.min(selection.startClientX, selection.endClientX);
  const top = Math.min(selection.startClientY, selection.endClientY);

  overlay.classList.remove("hidden");
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${Math.abs(selection.startClientX - selection.endClientX)}px`;
  overlay.style.height = `${Math.abs(selection.startClientY - selection.endClientY)}px`;
}

function hideDragOverlay(overlay: HTMLDivElement | null) {
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.style.width = "0px";
  overlay.style.height = "0px";
}

function setChartInteractionEnabled(container: HTMLDivElement | null, enabled: boolean) {
  if (!container) return;
  container.style.pointerEvents = enabled ? "" : "none";
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function brushRangeForChartXBounds(
  points: ChartPoint[],
  selection: DragSelection
): BrushRange | null {
  const minX = Math.min(selection.startX, selection.endX);
  const maxX = Math.max(selection.startX, selection.endX);
  let startIndex: number | null = null;
  let endIndex: number | null = null;

  points.forEach((point, index) => {
    if (point.chartX < minX || point.chartX > maxX) return;
    if (startIndex === null) startIndex = index;
    endIndex = index;
  });

  if (startIndex === null || endIndex === null) return null;
  return { startIndex, endIndex };
}

function brushRangeForDisplayedYBounds(
  frameYTicks: number[],
  displayedYTicks: number[],
  selection: DragSelection,
  plotBounds: PlotBounds | null
): BrushRange | null {
  if (!plotBounds || !displayedYTicks.length) return null;

  const minClientY = Math.min(selection.startClientY, selection.endClientY);
  const maxClientY = Math.max(selection.startClientY, selection.endClientY);
  const plotHeight = plotBounds.bottom - plotBounds.top;
  if (plotHeight <= 0) return null;

  const selectedTicks = displayedYTicks.filter((_, index) => {
    const rowCenterY = plotBounds.bottom - ((index + 0.5) / displayedYTicks.length) * plotHeight;
    return rowCenterY >= minClientY && rowCenterY <= maxClientY;
  });
  if (!selectedTicks.length) return null;

  const frameIndexByTick = new Map(frameYTicks.map((tick, index) => [tick, index]));
  const frameIndexes = selectedTicks
    .map((tick) => frameIndexByTick.get(tick))
    .filter((index): index is number => typeof index === "number");

  if (!frameIndexes.length) return null;
  return {
    startIndex: Math.min(...frameIndexes),
    endIndex: Math.max(...frameIndexes),
  };
}

function viewportFromFrameSelection(
  points: ChartPoint[],
  yTicks: number[],
  xRange: BrushRange,
  yRange: BrushRange
): DottedChartViewport | undefined {
  if (!points.length) return undefined;

  const selectedYTicks = yTicks.slice(yRange.startIndex, yRange.endIndex + 1);
  const selectedYTickSet = new Set(selectedYTicks);
  const selectedPoints = points
    .slice(xRange.startIndex, xRange.endIndex + 1)
    .filter((point) => selectedYTickSet.has(point.chartY));

  if (!selectedPoints.length) return undefined;

  const times = selectedPoints
    .map((point) => point.timestamp_unix)
    .filter(Number.isFinite);
  const rows = selectedPoints
    .map((point) => point.row_index)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!times.length && !rows.length) return undefined;

  return {
    t_min: times.length ? Math.min(...times) : undefined,
    t_max: times.length ? Math.max(...times) : undefined,
    row_min: rows.length ? Math.min(...rows) : undefined,
    row_max: rows.length ? Math.max(...rows) : undefined,
  };
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

function sampleAxisTicks(ticks: number[], maxLabels: number): number[] {
  if (ticks.length <= maxLabels) return ticks;
  if (maxLabels <= 0) return [];
  if (maxLabels === 1) return [ticks[0]];

  const lastIndex = ticks.length - 1;
  const sampled = new Set<number>();

  for (let index = 0; index < maxLabels; index += 1) {
    sampled.add(ticks[Math.round((index * lastIndex) / (maxLabels - 1))]);
  }

  return ticks.filter((tick) => sampled.has(tick));
}

function orderDisplayedYTicks(points: ChartPoint[], rowOrder: RowOrderOption): number[] {
  const rowTimes = new Map<number, { first: number; last: number }>();

  points.forEach((point) => {
    const current = rowTimes.get(point.chartY);
    if (!current) {
      rowTimes.set(point.chartY, {
        first: point.timestamp_unix,
        last: point.timestamp_unix,
      });
      return;
    }

    current.first = Math.min(current.first, point.timestamp_unix);
    current.last = Math.max(current.last, point.timestamp_unix);
  });

  return Array.from(rowTimes.entries())
    .sort(([leftTick, left], [rightTick, right]) => {
      const leftValue = rowOrder === "last_occurrence" ? left.last : left.first;
      const rightValue = rowOrder === "last_occurrence" ? right.last : right.first;
      return leftValue - rightValue || leftTick - rightTick;
    })
    .map(([tick]) => tick);
}

function sampleMinimapPoints(points: ChartPoint[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints) return points;

  const step = points.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, index) => points[Math.floor(index * step)]).filter(
    (point): point is ChartPoint => Boolean(point)
  );
}

type BrushRange = {
  startIndex: number;
  endIndex: number;
};

type DragSelection = {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  startClientX: number;
  endClientX: number;
  startClientY: number;
  endClientY: number;
  isDragging: boolean;
};

type DragPoint = {
  chartX: number;
  chartY: number;
  clientX: number;
  clientY: number;
};

type PlotBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function clampBrushRange(range: BrushRange, pointCount: number): BrushRange {
  if (pointCount <= 0) return { startIndex: 0, endIndex: 0 };
  const maxIndex = pointCount - 1;
  const startIndex = Math.max(0, Math.min(maxIndex, Math.floor(range.startIndex)));
  const endIndex = Math.max(startIndex, Math.min(maxIndex, Math.floor(range.endIndex)));
  return { startIndex, endIndex };
}

function fullBrushRange(pointCount: number): BrushRange {
  return { startIndex: 0, endIndex: Math.max(0, pointCount - 1) };
}

function isFullRange(range: BrushRange, pointCount: number): boolean {
  if (pointCount <= 0) return true;
  return range.startIndex === 0 && range.endIndex === pointCount - 1;
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

function truncateAxisLabel(label: string): string {
  if (label.length <= MAX_Y_TICK_LABEL_LENGTH) return label;
  return `${label.slice(0, MAX_Y_TICK_LABEL_LENGTH - 1)}...`;
}

function DottedChartYAxisTick({
  x,
  y,
  payload,
  labels,
}: {
  x?: number;
  y?: number;
  payload?: { value: number | string };
  labels: Map<number, string>;
}) {
  const numericValue = Number(payload?.value);
  const label = labels.get(numericValue) ?? formatAxisTick(numericValue);

  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text
        x={0}
        y={0}
        dy={4}
        textAnchor="end"
        className="fill-muted-foreground text-[11px]"
      >
        <title>{label}</title>
        {truncateAxisLabel(label)}
      </text>
    </g>
  );
}

function isTimeAxis(axis: AxisOption): boolean {
  return axis.type === "time" || axis.type === "timestamp" || axis.type === "timestamp_unix";
}

function formatUnixDateTick(value: number): string {
  const milliseconds = Math.abs(value) >= 1_000_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toLocaleDateString("en-GB");
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
      return formatColumnLabel(axis.name);
    case "none":
      return "None";
    default:
      return "Value";
  }
}

function axisOptionKey(axis: AxisOption): string {
  return axis.type === "event_attribute" ? `${axis.type}:${axis.name}` : axis.type;
}

function formatColumnLabel(name: string): string {
  if (name.startsWith("object_type:")) return name.slice("object_type:".length);
  return name;
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

export type { AxisOption, DottedChartViewport, OCEvent, RowOrderOption };
