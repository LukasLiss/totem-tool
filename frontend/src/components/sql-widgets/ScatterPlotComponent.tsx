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
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { CHART_SKETCH_HINT, SCATTER_DEFAULT_QUERY } from "./constants";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { ChartTitle, WidgetMessage } from "./shared";
import { linkedQueryOf, type SqlWidgetNodeFields, type SqlWidgetProps } from "./sqlWidgetUtils";
import { categoryFills, previewColors, type ChartColors } from "./chartColors";
import { ChartValueLegend } from "./chartLegend";
import type { ChartStyle, LegendPosition, PointSize } from "./chartLegendUtils";
import { POINT_RADIUS_PX, TRANSPARENT_POINT_OPACITY, buildScatterSeries, scatterColors } from "./scatterUtils";
import WidgetDraftTile from "@/components/WidgetDraftTile";
import ScatterPlotSketch from "./ScatterPlotSketch";
import ScatterPlotSettingsDialog, { type ScatterPlotSettings } from "./ScatterPlotSettingsDialog";

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
}) => {
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
  });

  const { series, xKey, yKey, seriesKey, config, legendItems } = useMemo(() => {
    const built = buildScatterSeries(data.rows, data.columns, { xColumn, yColumn, seriesColumn, maxSeries });
    const fills = categoryFills(built.slices, scatterColors(colors, Boolean(built.seriesKey)));
    const series = built.series.map((s, i) => ({ ...s, color: fills[i] }));
    const config: ChartConfig = {};
    series.forEach((s) => {
      config[s.name] = { label: s.name, color: s.color };
    });
    const legendItems = series.map((s) => ({ label: s.name, color: s.color }));
    return { ...built, series, config, legendItems };
  }, [data.rows, data.columns, xColumn, yColumn, seriesColumn, maxSeries, colors]);

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
            colors={previewColors(scatterColors(colors, seriesColumn !== ""))}
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

  if (!fileId) return <WidgetMessage>Select an event log to draw this plot.</WidgetMessage>;
  if (data.error) return <WidgetMessage tone="error">{data.error}</WidgetMessage>;
  if (data.loading) return <WidgetMessage>Loading…</WidgetMessage>;
  if (series.length === 0) {
    return <WidgetMessage>No numeric points to display. Configure the query and columns in edit mode.</WidgetMessage>;
  }

  const showLegend = Boolean(seriesKey) && (legendPosition === "bottom" || legendPosition === "columns");

  return (
    <Card className="flex h-full w-full flex-col overflow-hidden rounded-none">
      <ChartTitle title={title} />
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <ChartContainer config={config} className="aspect-auto min-h-0 w-full flex-1">
          <ScatterChart margin={{ top: 8, right: 16, bottom: xLabel ? 24 : 8, left: yLabel ? 16 : 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel || xKey}
              tickLine={false}
              label={xLabel ? { value: xLabel, position: "insideBottom", offset: -12, fontSize: 11 } : undefined}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel || yKey}
              tickLine={false}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 } : undefined}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={<ChartTooltipContent hideLabel={!seriesKey} />}
            />
            {series.map((s) => (
              <Scatter
                key={s.name}
                name={s.name}
                data={s.points}
                fill={s.color}
                // Points drawn here with the chosen size and transparency.
                shape={({ cx, cy }: ScatterShapeProps) => (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={POINT_RADIUS_PX[pointSize]}
                    fill={s.color}
                    fillOpacity={transparentPoints ? TRANSPARENT_POINT_OPACITY : 1}
                  />
                )}
              />
            ))}
          </ScatterChart>
        </ChartContainer>
        {showLegend && (
          <ChartValueLegend
            items={legendItems}
            layout={legendPosition === "columns" ? "columns" : "bottom"}
            className="max-h-[35%] w-full shrink-0 overflow-y-auto"
          />
        )}
        {data.truncated && (
          <p className="text-[11px] text-muted-foreground">showing the first 5,000 rows</p>
        )}
      </CardContent>
    </Card>
  );
};

export default ScatterPlotComponent;
