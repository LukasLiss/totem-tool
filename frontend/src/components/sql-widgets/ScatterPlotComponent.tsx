/**
 * ScatterPlotComponent — one point per result row from numeric x / y
 * columns, optionally grouped into series by a series column. The largest
 * series (up to "Max series") get their own color, the rest is drawn as one
 * grey "Other" series; colors and the legend are configurable. In edit mode
 * the tile shows a layout sketch and the settings open in a popup.
 */

import React, { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, type ScatterShapeProps } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { CHART_SKETCH_HINT, SCATTER_DEFAULT_QUERY } from "./constants";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { WidgetMessage } from "./shared";
import { WidgetHeader } from "@/components/ui/WidgetTitle";
import { formatChartNumber, linkedQueryOf, type SqlWidgetNodeFields, type SqlWidgetProps } from "./sqlWidgetUtils";
import {
  NO_VALUE_COLOR,
  categoryFills,
  colorsDependOnLabels,
  previewColors,
  valueFill,
  type ChartColors,
} from "./chartColors";
import { ChartValueLegend, ValueRangeLegend } from "./chartLegend";
import type { ChartStyle, LegendPosition, PointSize } from "./chartLegendUtils";
import {
  POINT_RADIUS_PX,
  TRANSPARENT_POINT_OPACITY,
  buildScatterSeries,
  buildValuePoints,
  columnOrderability,
  notOrderableNotice,
  scatterColors,
  valueGradient,
} from "./scatterUtils";
import WidgetDraftTile from "@/components/WidgetDraftTile";
import ScatterPlotSketch from "./ScatterPlotSketch";
import VerticalAxisLabel from "./VerticalAxisLabel";
import { AXIS_STYLE, GRID_DASH, yAxisWidthFor } from "./chartAxis";
import HeadedTooltip from "./HeadedTooltip";
import ScatterPlotSettingsDialog, { type ScatterPlotSettings } from "./ScatterPlotSettingsDialog";
import { useDashboardLocalFilter } from "@/hooks/useDashboardLocalFilter";


export interface ScatterPlotNodeFields extends SqlWidgetNodeFields {
  x_column?: string;
  y_column?: string;
  series_column?: string;
  x_label?: string;
  y_label?: string;
  chart_style?: ChartStyle;
}

const ScatterPlotComponent: React.FC<SqlWidgetProps<ScatterPlotNodeFields>> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
  dashboardId,
}) => {
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [localFilterParams, handleLocalFilterChange] = useDashboardLocalFilter(
    node, dashboardId, onUpdate,
  );

  const [title, setTitle] = useState(node.title ?? "");
  const [query, setQuery] = useState(node.query ?? SCATTER_DEFAULT_QUERY);
  const [linked, setLinked] = useState<LinkedQuery | null>(linkedQueryOf(node));
  const [xColumn, setXColumn] = useState(node.x_column ?? "");
  const [yColumn, setYColumn] = useState(node.y_column ?? "");
  const [seriesColumn, setSeriesColumn] = useState(node.series_column ?? "");
  const [xLabel, setXLabel] = useState(node.x_label ?? "");
  const [yLabel, setYLabel] = useState(node.y_label ?? "");
  const [legendPosition, setLegendPosition] = useState<LegendPosition>(node.chart_style?.legend?.position ?? "bottom");
  const [pointSize, setPointSize] = useState<PointSize>(node.chart_style?.point_size ?? "medium");
  const [transparentPoints, setTransparentPoints] = useState(node.chart_style?.transparent_points ?? false);
  const [colors, setColors] = useState<ChartColors>(node.chart_style?.colors ?? {});
  const [maxSeries, setMaxSeries] = useState<number | null>(node.chart_style?.max_categories ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setTitle(node.title ?? "");
    setQuery(node.query ?? SCATTER_DEFAULT_QUERY);
    setLinked(linkedQueryOf(node));
    setXColumn(node.x_column ?? "");
    setYColumn(node.y_column ?? "");
    setSeriesColumn(node.series_column ?? "");
    setXLabel(node.x_label ?? "");
    setYLabel(node.y_label ?? "");
    setLegendPosition(node.chart_style?.legend?.position ?? "bottom");
    setPointSize(node.chart_style?.point_size ?? "medium");
    setTransparentPoints(node.chart_style?.transparent_points ?? false);
    setColors(node.chart_style?.colors ?? {});
    setMaxSeries(node.chart_style?.max_categories ?? null);
  }, [node]);

  const fileId = selectedFile?.id;
  const projectId = selectedFile?.project;

  const settings: ScatterPlotSettings = {
    title,
    query,
    linked,
    xColumn,
    yColumn,
    seriesColumn,
    xLabel,
    yLabel,
    legendPosition,
    pointSize,
    transparentPoints,
    colors,
    maxSeries,
  };

  const applySettings = (next: ScatterPlotSettings) => {
    setTitle(next.title);
    setQuery(next.query);
    setLinked(next.linked);
    setXColumn(next.xColumn);
    setYColumn(next.yColumn);
    setSeriesColumn(next.seriesColumn);
    setXLabel(next.xLabel);
    setYLabel(next.yLabel);
    setLegendPosition(next.legendPosition);
    setPointSize(next.pointSize);
    setTransparentPoints(next.transparentPoints);
    setColors(next.colors);
    setMaxSeries(next.maxSeries);
    onUpdate?.({
      title: next.title,
      query: next.query,
      query_asset: next.linked?.id ?? null,
      query_asset_name: next.linked?.name ?? null,
      x_column: next.xColumn,
      y_column: next.yColumn,
      series_column: next.seriesColumn,
      x_label: next.xLabel,
      y_label: next.yLabel,
      chart_style: {
        ...node.chart_style,
        legend: { ...node.chart_style?.legend, position: next.legendPosition },
        point_size: next.pointSize,
        transparent_points: next.transparentPoints,
        colors: next.colors,
        max_categories: next.maxSeries ?? undefined,
      },
    });
  };

  const data = useSqlQueryData({
    fileId,
    query,
    queryAssetId: linked?.id,
    enabled: !isEditMode,
    limit: 5000,
    filterEnabled,
    localFilterParams: Object.keys(localFilterParams).length > 0 ? localFilterParams : undefined,
  });

  const { series, xKey, yKey, seriesKey, config, legendItems, valueRange, notice } = useMemo(() => {
    // "By value" colors need numbers in the series column; without them the
    // points are colored by category, with a notice below the chart.
    const orderability =
      seriesColumn !== "" && colors.mode === "value" ? columnOrderability(data.rows, seriesColumn) : null;

    if (orderability?.orderable) {
      const built = buildValuePoints(data.rows, data.columns, { xColumn, yColumn, seriesColumn });
      const points = built.points.map((p) => ({ ...p, fill: valueFill(colors, p.c, built.min, built.max) }));
      const name = seriesColumn;
      const series = points.length > 0 ? [{ name, points, color: NO_VALUE_COLOR }] : [];
      const config: ChartConfig = { [name]: { label: name } };
      const withoutValue = built.withoutValue;
      return {
        series,
        xKey: built.xKey,
        yKey: built.yKey,
        seriesKey: seriesColumn,
        config,
        legendItems: [],
        valueRange: { min: built.min, max: built.max },
        notice: withoutValue > 0
          ? `${withoutValue.toLocaleString()} point${withoutValue === 1 ? "" : "s"} without a value in “${seriesColumn}”, shown grey.`
          : undefined,
      };
    }

    const built = buildScatterSeries(data.rows, data.columns, { xColumn, yColumn, seriesColumn, maxSeries });
    const seriesColors = scatterColors(colors, Boolean(built.seriesKey));
    const fills = categoryFills(
      built.slices,
      seriesColors.mode === "value" ? { ...seriesColors, mode: "category" } : seriesColors
    );
    // Each point carries its series and color, for the tooltip's top row.
    const series = built.series.map((s, i) => ({
      ...s,
      color: fills[i],
      points: s.points.map((p) => ({ ...p, series: s.name, fill: fills[i] })),
    }));
    const config: ChartConfig = {};
    series.forEach((s) => {
      config[s.name] = { label: s.name, color: s.color };
    });
    const legendItems = series.map((s) => ({ label: s.name, color: s.color }));
    return {
      ...built,
      series,
      config,
      legendItems,
      valueRange: null,
      notice: orderability && data.rows.length > 0 ? notOrderableNotice(seriesColumn, orderability.example) : undefined,
    };
  }, [data.rows, data.columns, xColumn, yColumn, seriesColumn, maxSeries, colors]);

  // The real series for the edit-mode sketch, loaded like the settings popup
  // does, so per-series colors show on the tile too. Only needed when the
  // colors depend on the series names.
  // The y axis as wide as its tick numbers (and the y label) need, from the data only.
  const yAxisWidth = useMemo(
    () => yAxisWidthFor(series.flatMap((s) => s.points.map((p) => p.y)), Boolean(yLabel)),
    [series, yLabel]
  );

  const hasSeries = seriesColumn !== "";
  const sketchColors = scatterColors(colors, hasSeries);
  const sketchData = useSqlQueryData({
    fileId,
    query,
    queryAssetId: linked?.id,
    enabled: isEditMode && hasSeries && colorsDependOnLabels(sketchColors),
    limit: 5000,
  });
  const sketchLabels = useMemo(
    () =>
      hasSeries
        ? buildScatterSeries(sketchData.rows, sketchData.columns, { xColumn, yColumn, seriesColumn, maxSeries })
            .slices.map((slice) => slice.label)
        : [],
    [hasSeries, sketchData.rows, sketchData.columns, xColumn, yColumn, seriesColumn, maxSeries]
  );

  if (isEditMode) {
    return (
      <WidgetDraftTile
        typeLabel="Scatter plot"
        hint={CHART_SKETCH_HINT}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <ScatterPlotSketch
            title={title}
            xLabel={xLabel}
            yLabel={yLabel}
            hasSeries={seriesColumn !== ""}
            legendPosition={legendPosition}
            pointSize={pointSize}
            transparentPoints={transparentPoints}
            colors={previewColors(sketchColors, sketchLabels)}
            gradient={hasSeries && colors.mode === "value" ? valueGradient(colors) : undefined}
            className="h-full w-full"
          />
        }
      >
        <ScatterPlotSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          widgetId={node.component_id}
          settings={settings}
          onApply={applySettings}
          fileId={fileId}
          projectId={projectId}
        />
      </WidgetDraftTile>
    );
  }

  const showLegend = Boolean(seriesKey) && (legendPosition === "bottom" || legendPosition === "columns");
  // With an x label: the 7px the label sits below the axis (offset -7), plus 8px of air to the legend.
  // The y label sits 5px inside the y axis' box, so 4px on the left give it about the same air as
  // the x label has below.
  const margin = { top: 8, right: 16, bottom: xLabel ? 15 : 8, left: 4 };

  // The header (with the filters) stays while there is nothing to draw.
  return (
    // No card padding above, a little below (on top of the content's p-3).
    <Card className="flex h-full w-full flex-col gap-0 overflow-hidden rounded-none pt-0 pb-2">
      <WidgetHeader
        label={title}
        fileId={fileId}
        filterEnabled={filterEnabled}
        onToggleFilter={() => setFilterEnabled((p) => !p)}
        localFilterParams={localFilterParams}
        onLocalFilterChange={handleLocalFilterChange}
      />
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {!fileId ? (
          <WidgetMessage>Select an event log to draw this plot.</WidgetMessage>
        ) : data.error ? (
          <WidgetMessage tone="error">{data.error}</WidgetMessage>
        ) : data.loading ? (
          <WidgetMessage>Loading…</WidgetMessage>
        ) : series.length === 0 ? (
          <WidgetMessage>No numeric points to display. Configure the query and columns in edit mode.</WidgetMessage>
        ) : (
          <>
        <ChartContainer config={config} className="aspect-auto min-h-0 w-full flex-1">
          <ScatterChart margin={margin}>
            <CartesianGrid strokeDasharray={GRID_DASH} />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel || xKey}
              {...AXIS_STYLE}
              tickFormatter={formatChartNumber}
              label={xLabel ? { value: xLabel, position: "insideBottom", offset: -7, fontSize: 11 } : undefined}
            />
            <YAxis
              type="number"
              width={yAxisWidth}
              dataKey="y"
              name={yLabel || yKey}
              {...AXIS_STYLE}
              tickFormatter={formatChartNumber}
              label={yLabel ? { content: (props) => <VerticalAxisLabel {...props} text={yLabel} fontSize={11} /> } : undefined}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              // Top row: the point's series in its color ("By value": the color
              // column and the point's value there); below, x and y.
              content={
                <HeadedTooltip
                  heading={(point) =>
                    !seriesKey
                      ? null
                      : valueRange
                        ? { label: seriesKey, color: point.fill as string, value: point.c ?? "no value" }
                        : { label: String(point.series ?? ""), color: point.fill as string }
                  }
                />
              }
            />
            {series.map((s) => (
              <Scatter
                key={s.name}
                name={s.name}
                data={s.points}
                fill={s.color}
                // Points drawn here with the chosen size and transparency;
                // "By value" points carry their own color.
                shape={({ cx, cy, payload }: ScatterShapeProps) => (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={POINT_RADIUS_PX[pointSize]}
                    fill={(payload as { fill?: string } | undefined)?.fill ?? s.color}
                    fillOpacity={transparentPoints ? TRANSPARENT_POINT_OPACITY : 1}
                  />
                )}
              />
            ))}
          </ScatterChart>
        </ChartContainer>
        {showLegend && (
          // Inset like the plot area, so the legend centers under the plot
          // (as the x label does), not under the plot plus the y axis.
          <div
            className="max-h-[35%] w-full shrink-0 overflow-y-auto"
            style={{ paddingLeft: margin.left + yAxisWidth, paddingRight: margin.right }}
          >
            {valueRange ? (
              <ValueRangeLegend
                label={seriesKey}
                low={valueGradient(colors)[0]}
                high={valueGradient(colors)[1]}
                min={valueRange.min}
                max={valueRange.max}
                className="w-full"
              />
            ) : (
              <ChartValueLegend
                items={legendItems}
                layout={legendPosition === "columns" ? "columns" : "bottom"}
                className="w-full"
              />
            )}
          </div>
        )}
        {notice && <p role="status" className="text-[11px] text-amber-700 dark:text-amber-400">{notice}</p>}
        {data.truncated && (
          <p className="text-[11px] text-muted-foreground">showing the first 5,000 rows</p>
        )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ScatterPlotComponent;
