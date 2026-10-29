/**
 * BarChartComponent — one bar per result row. The query supplies a label
 * column and a numeric value column; the widget can draw bars vertically
 * or horizontally, optionally print the value on each bar, show only the
 * largest bars, and color them (one color, or per category). In edit mode
 * the tile shows a layout sketch and the settings open in a popup.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { BAR_CHART_DEFAULT_QUERY, CHART_SKETCH_HINT } from "./constants";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { ChartTitle, WidgetMessage } from "./shared";
import WidgetDraftTile from "@/components/WidgetDraftTile";
import {
  firstNumericColumn,
  linkedQueryOf,
  toNumber,
  type SqlWidgetNodeFields,
  type SqlWidgetProps,
} from "./sqlWidgetUtils";
import { categoryFills, previewColors, type ChartColors } from "./chartColors";
import { limitCategories } from "./chartData";
import type { ChartStyle } from "./chartLegendUtils";
import BarChartSketch from "./BarChartSketch";
import BarChartSettingsDialog, { type BarChartSettings } from "./BarChartSettingsDialog";

export interface BarChartNodeFields extends SqlWidgetNodeFields {
  label_column?: string;
  value_column?: string;
  horizontal?: boolean;
  show_values?: boolean;
  chart_style?: ChartStyle;
}



const BarChartComponent: React.FC<SqlWidgetProps<BarChartNodeFields>> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const [title, setTitle] = useState(node.title ?? "");
  const [query, setQuery] = useState(node.query ?? BAR_CHART_DEFAULT_QUERY);
  const [linked, setLinked] = useState<LinkedQuery | null>(linkedQueryOf(node));
  const [labelColumn, setLabelColumn] = useState(node.label_column ?? "");
  const [valueColumn, setValueColumn] = useState(node.value_column ?? "");
  const [horizontal, setHorizontal] = useState(node.horizontal ?? false);
  const [showValues, setShowValues] = useState(node.show_values ?? false);
  const [colors, setColors] = useState<ChartColors>(node.chart_style?.colors ?? {});
  const [maxCategories, setMaxCategories] = useState<number | null>(node.chart_style?.max_categories ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setTitle(node.title ?? "");
    setQuery(node.query ?? BAR_CHART_DEFAULT_QUERY);
    setLinked(linkedQueryOf(node));
    setLabelColumn(node.label_column ?? "");
    setValueColumn(node.value_column ?? "");
    setHorizontal(node.horizontal ?? false);
    setShowValues(node.show_values ?? false);
    setColors(node.chart_style?.colors ?? {});
    setMaxCategories(node.chart_style?.max_categories ?? null);
  }, [node]);

  const fileId = selectedFile?.id;
  const projectId = selectedFile?.project;

  // Bar charts default to a single color.
  const barColors: ChartColors = useMemo(() => ({ mode: "single", ...colors }), [colors]);

  const settings: BarChartSettings = {
    title,
    query,
    linked,
    labelColumn,
    valueColumn,
    horizontal,
    showValues,
    colors,
    maxCategories,
  };

  const applySettings = (next: BarChartSettings) => {
    setTitle(next.title);
    setQuery(next.query);
    setLinked(next.linked);
    setLabelColumn(next.labelColumn);
    setValueColumn(next.valueColumn);
    setHorizontal(next.horizontal);
    setShowValues(next.showValues);
    setColors(next.colors);
    setMaxCategories(next.maxCategories);
    onUpdate?.({
      title: next.title,
      query: next.query,
      query_asset: next.linked?.id ?? null,
      query_asset_name: next.linked?.name ?? null,
      label_column: next.labelColumn,
      value_column: next.valueColumn,
      horizontal: next.horizontal,
      show_values: next.showValues,
      chart_style: {
        ...node.chart_style,
        colors: next.colors,
        max_categories: next.maxCategories ?? undefined,
      },
    });
  };

  const data = useSqlQueryData({
    fileId,
    query,
    queryAssetId: linked?.id,
    enabled: !isEditMode,
    limit: 500,
  });

  const { chartData, valueKey } = useMemo(() => {
    const valueKey = valueColumn || firstNumericColumn(data.rows, data.columns) || data.columns[1] || "";
    const labelKey = labelColumn || data.columns.find((c) => c !== valueKey) || data.columns[0] || "";
    const bars = limitCategories(
      data.rows.map((r) => ({
        label: r[labelKey] == null ? "NULL" : String(r[labelKey]),
        value: toNumber(r[valueKey]) ?? 0,
      })),
      maxCategories,
      { groupRest: false }
    );
    const fills = categoryFills(bars, barColors);
    const chartData = bars.map((bar, i) => ({ ...bar, fill: fills[i] }));
    return { chartData, valueKey };
  }, [data.rows, data.columns, labelColumn, valueColumn, maxCategories, barColors]);

  const chartConfig: ChartConfig = useMemo(
    () => ({ value: { label: valueKey || "value", color: "var(--foreground)" } }),
    [valueKey]
  );

  if (isEditMode) {
    // In edit mode the tile shows a layout sketch; the settings open in a popup.
    return (
      <WidgetDraftTile
        typeLabel="Bar chart"
        hint={CHART_SKETCH_HINT}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <BarChartSketch
            title={title}
            horizontal={horizontal}
            showValues={showValues}
            colors={previewColors(barColors)}
            className="h-full w-full"
          />
        }
      >
        <BarChartSettingsDialog
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

  if (!fileId) return <WidgetMessage>Select an event log to draw this chart.</WidgetMessage>;
  if (data.error) return <WidgetMessage tone="error">{data.error}</WidgetMessage>;
  if (data.loading) return <WidgetMessage>Loading…</WidgetMessage>;
  if (chartData.length === 0 || !valueKey) {
    return <WidgetMessage>No data to display. Configure the query and columns in edit mode.</WidgetMessage>;
  }

  return (
    <Card className="flex h-full w-full flex-col overflow-hidden rounded-none">
      <ChartTitle title={title} />
      <CardContent className="min-h-0 flex-1 p-3">
        <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
          <BarChart
            data={chartData}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: showValues ? 18 : 6, right: showValues && horizontal ? 36 : 12, bottom: 4, left: 4 }}
          >
            <CartesianGrid vertical={horizontal} horizontal={!horizontal} strokeDasharray="3 3" />
            {horizontal ? (
              <>
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={110}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={chartData.length > 8 ? -30 : 0}
                  textAnchor={chartData.length > 8 ? "end" : "middle"}
                  height={chartData.length > 8 ? 60 : 30}
                  tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
                />
                <YAxis tickLine={false} axisLine={false} />
              </>
            )}
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltipContent labelKey="label" nameKey="value" />}
            />
            <Bar
              dataKey="value"
              radius={4}
              name={valueKey}
              // Each bar in its own color (from its data row); replaces the deprecated <Cell>.
              shape={({ x, y, width, height, payload }: BarShapeProps) => (
                <Rectangle x={x} y={y} width={width} height={height} radius={4} fill={payload?.fill} />
              )}
            >
              {showValues && (
                <LabelList
                  dataKey="value"
                  position={horizontal ? "right" : "top"}
                  className="fill-foreground"
                  fontSize={11}
                  formatter={(v: number) => v.toLocaleString()}
                />
              )}
            </Bar>
          </BarChart>
        </ChartContainer>
        {data.truncated && (
          <p className="pt-1 text-[11px] text-muted-foreground">showing the first 500 rows</p>
        )}
      </CardContent>
    </Card>
  );
};

export default BarChartComponent;
