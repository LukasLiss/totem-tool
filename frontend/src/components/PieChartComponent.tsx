"use client"

import React, { useState, useEffect } from 'react';
import { Label as PieLabel, Pie, PieChart, type PieLabelRenderProps } from "recharts";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GridStackNode } from 'gridstack';
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { linkedQueryOf } from "@/components/sql-widgets/sqlWidgetUtils";
import { ChartValueLegend, PieCallout } from "@/components/sql-widgets/chartLegend";
import {
  fitPieCallouts,
  limitCategories,
  type ChartStyle,
  type LegendPosition,
  type LegendValues,
} from "@/components/sql-widgets/chartLegendUtils";
import { categoryFills, previewColors, type ChartColors } from "@/components/sql-widgets/chartColors";
import PieChartSketch from "./PieChartSketch";
import PieChartSettingsDialog, { type PieChartSettings } from "./PieChartSettingsDialog";
import { SelectedFile } from '@/contexts/SelectedFileContext';

// Matches the `max-h-[450px]` of the chart container below.
const CHART_MAX_HEIGHT = 450;
// Donut hole size relative to the outer radius (recharts' 50% / 80% defaults).
const DONUT_INNER_SHARE = 0.625;
// Recharts keeps a 5px margin on every side of a pie chart.
const RECHARTS_MARGIN = 5;
// Font size limits (px) for the donut center: the total and the center text below it.
const CENTER_VALUE_MAX = 30;
const CENTER_VALUE_MIN = 10;
const CENTER_TEXT_MAX = 14;
const CENTER_TEXT_MIN = 8;
const CENTER_LINE_GAP = 4;
// Rough average glyph width as a share of the font size, for sizing without measuring.
const GLYPH_WIDTH = 0.6;

/**
 * Sizes the donut center (total plus center text) to fit inside the hole of
 * radius `innerRadius`: both lines shrink with the hole, and center text that
 * is still too long is cut off with an ellipsis. Positions are offsets from
 * the chart center.
 */
function fitDonutCenter(value: string, ring: string, innerRadius: number) {
  if (innerRadius <= 0) {
    // Hole size not known yet: the full-size layout, nothing shortened.
    return {
      value,
      valueSize: CENTER_VALUE_MAX,
      valueY: -CENTER_TEXT_MAX / 2,
      ring,
      ringSize: CENTER_TEXT_MAX,
      ringY: CENTER_VALUE_MAX / 2 + CENTER_LINE_GAP,
    };
  }
  // Usable box inside the hole, keeping clear of the ring.
  const box = innerRadius * 2 * 0.75;
  const clamp = (size: number, min: number, max: number) => Math.max(min, Math.min(max, size));
  let valueSize = clamp(box / (Math.max(value.length, 1) * GLYPH_WIDTH), CENTER_VALUE_MIN, CENTER_VALUE_MAX);
  let ringSize = clamp(box / (Math.max(ring.length, 1) * GLYPH_WIDTH), CENTER_TEXT_MIN, CENTER_TEXT_MAX);
  ringSize = Math.min(ringSize, valueSize * 0.6);

  // Shrink both together if the two lines are taller than the box.
  const height = valueSize + CENTER_LINE_GAP + ringSize;
  if (height > box && box > 0) {
    const scale = box / height;
    valueSize = Math.max(CENTER_VALUE_MIN, valueSize * scale);
    ringSize = Math.max(CENTER_TEXT_MIN, ringSize * scale);
  }

  const maxChars = Math.max(1, Math.floor(box / (ringSize * GLYPH_WIDTH)));
  const shortRing = ring.length > maxChars ? `${ring.slice(0, Math.max(1, maxChars - 1))}…` : ring;
  const blockTop = -(valueSize + CENTER_LINE_GAP + ringSize) / 2;
  return {
    value,
    valueSize,
    valueY: blockTop + valueSize / 2,
    ring: shortRing,
    ringSize,
    ringY: blockTop + valueSize + CENTER_LINE_GAP + ringSize / 2,
  };
}


// Define props interface for components (extend as needed)
interface ComponentProps {
  node: GridStackNode & {
    component_id: number;
    component_name?: string;
    query?: string;
    query_asset?: number | null;
    query_asset_name?: string | null;
    ring_text?: string;
    chart_type?: 'pie' | 'donut';
    title?: string;
    show_legend?: boolean;
    show_tooltip?: boolean;
    label_column?: string;
    value_column?: string;
    chart_style?: ChartStyle;
  };
  onUpdate?: (updates: Partial<GridStackNode>) => void;
  isEditMode?: boolean;
  dashboardId: number;
  selectedFile?: SelectedFile;
}

const PieChartComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  // State for edit mode
  const [query, setQuery] = useState(node.query || '');
  const [linked, setLinked] = useState<LinkedQuery | null>(linkedQueryOf(node));
  const [ringText, setRingText] = useState(node.ring_text || '');
  const [chartType, setChartType] = useState<'pie' | 'donut'>(node.chart_type || 'donut');
  const [title, setTitle] = useState(node.title || '');
  const [labelColumn, setLabelColumn] = useState(node.label_column || '');
  const [valueColumn, setValueColumn] = useState(node.value_column || '');
  const [showLegend, setShowLegend] = useState(node.show_legend ?? true);
  const [legendPosition, setLegendPosition] = useState<LegendPosition>(node.chart_style?.legend?.position ?? 'bottom');
  const [legendValues, setLegendValues] = useState<LegendValues>(node.chart_style?.legend?.values ?? 'none');
  const [showCategoryCount, setShowCategoryCount] = useState(node.chart_style?.show_category_count ?? true);
  const [colors, setColors] = useState<ChartColors>(node.chart_style?.colors ?? {});
  const [maxCategories, setMaxCategories] = useState<number | null>(node.chart_style?.max_categories ?? null);

  // Sync with node when it changes
  useEffect(() => {
    setQuery(node.query || '');
    setLinked(linkedQueryOf(node));
    setRingText(node.ring_text || '');
    setChartType(node.chart_type || 'donut');
    setTitle(node.title || '');
    setLabelColumn(node.label_column || '');
    setValueColumn(node.value_column || '');
    setShowLegend(node.show_legend ?? true);
    setLegendPosition(node.chart_style?.legend?.position ?? 'bottom');
    setLegendValues(node.chart_style?.legend?.values ?? 'none');
    setShowCategoryCount(node.chart_style?.show_category_count ?? true);
    setColors(node.chart_style?.colors ?? {});
    setMaxCategories(node.chart_style?.max_categories ?? null);
  }, [node]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const fileId = selectedFile?.id;
  const projectId = selectedFile?.project;

  // View mode: run the (local or linked) query and shape rows for recharts.
  const data = useSqlQueryData({
    fileId,
    query,
    queryAssetId: linked?.id,
    enabled: !isEditMode && Boolean(labelColumn && valueColumn),
    limit: 500,
  });
  const isLoading = data.loading;
  const error = data.error;
  const chartData = React.useMemo(() => {
    if (!labelColumn || !valueColumn) return [];
    const slices = limitCategories(
      data.rows.map((row) => ({
        label: String(row[labelColumn]),
        value: parseFloat(String(row[valueColumn])) || 0,
      })),
      maxCategories
    );
    const fills = categoryFills(slices, colors);
    return slices.map((slice, index): Record<string, unknown> => ({
      [labelColumn]: slice.label,
      [valueColumn]: slice.value,
      fill: fills[index],
    }));
  }, [data.rows, labelColumn, valueColumn, colors, maxCategories]);
  // Categories in the query result, before grouping into "Other".
  const categoryCount = labelColumn && valueColumn ? data.rows.length : 0;

  // The applied settings, edited as a draft in the settings popup.
  const settings: PieChartSettings = {
    title,
    query,
    linked,
    labelColumn,
    valueColumn,
    chartType,
    ringText,
    showLegend,
    legendPosition,
    legendValues,
    showCategoryCount,
    colors,
    maxCategories,
  };

  const applySettings = (next: PieChartSettings) => {
    setTitle(next.title);
    setQuery(next.query);
    setLinked(next.linked);
    setLabelColumn(next.labelColumn);
    setValueColumn(next.valueColumn);
    setChartType(next.chartType);
    setRingText(next.ringText);
    setShowLegend(next.showLegend);
    setLegendPosition(next.legendPosition);
    setLegendValues(next.legendValues);
    setShowCategoryCount(next.showCategoryCount);
    setColors(next.colors);
    setMaxCategories(next.maxCategories);
    onUpdate?.({
      title: next.title,
      query: next.query,
      query_asset: next.linked?.id ?? null,
      query_asset_name: next.linked?.name ?? null,
      label_column: next.labelColumn,
      value_column: next.valueColumn,
      chart_type: next.chartType,
      ring_text: next.ringText,
      show_legend: next.showLegend,
      chart_style: {
        ...node.chart_style,
        show_category_count: next.showCategoryCount,
        colors: next.colors,
        max_categories: next.maxCategories ?? undefined,
        legend: {
          ...node.chart_style?.legend,
          position: next.legendPosition,
          values: next.legendValues,
        },
      },
    });
  };

  // Generate chart config dynamically
  const chartConfig: ChartConfig = React.useMemo(() => {
    const config: ChartConfig = {
      [valueColumn]: {
        label: valueColumn,
      }
    };

    chartData.forEach((item) => {
      const key = String(item[labelColumn]);
      config[key] = {
        label: key,
        color: String(item.fill),
      };
    });

    return config;
  }, [chartData, labelColumn, valueColumn]);

  const totalValue = React.useMemo(() => {
    return chartData.reduce((acc, curr) => acc + (Number(curr[valueColumn]) || 0), 0);
  }, [chartData, valueColumn]);

  const legendItems = React.useMemo(
    () =>
      chartData.map((item) => ({
        label: String(item[labelColumn]),
        value: Number(item[valueColumn]) || 0,
        color: String(item.fill),
      })),
    [chartData, labelColumn, valueColumn]
  );

  // Callouts need the chart's pixel size to shrink the pie until they fit.
  const [chartArea, setChartArea] = useState<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!chartArea) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setChartSize({ width, height: Math.min(height, CHART_MAX_HEIGHT) });
    });
    observer.observe(chartArea);
    return () => observer.disconnect();
  }, [chartArea]);

  const showCallouts = showLegend && legendPosition === 'callouts';
  const calloutFit = React.useMemo(
    () =>
      showCallouts && chartSize && chartSize.width > 0 && chartSize.height > 0
        ? fitPieCallouts(legendItems, legendValues, chartSize.width, chartSize.height)
        : null,
    [showCallouts, chartSize, legendItems, legendValues]
  );
  // Radius of the donut hole in px, for sizing the center text: the fitted
  // callout radius, or else recharts' default 50% of half the smaller chart side.
  const donutHoleRadius = calloutFit
    ? calloutFit.radius * DONUT_INNER_SHARE
    : chartSize
      ? ((Math.min(chartSize.width, chartSize.height) - 2 * RECHARTS_MARGIN) / 2) * 0.5
      : 0;

  const calloutShares = React.useMemo(
    () => legendItems.map((item) => (totalValue ? item.value / totalValue : 0)),
    [legendItems, totalValue]
  );
  const calloutLabel = React.useCallback(
    (props: PieLabelRenderProps) => (
      <PieCallout {...props} values={legendValues} shares={calloutShares} twoLines={calloutFit?.twoLines} />
    ),
    [legendValues, calloutShares, calloutFit]
  );

  if (isEditMode) {
    // In edit mode the tile shows a layout sketch; the settings open in a popup.
    return (
      <Card
        className="w-full h-full rounded-none flex flex-col gap-0 overflow-hidden py-0"
        onDoubleClick={() => setSettingsOpen(true)}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <span className="truncate text-xs font-medium text-muted-foreground">Pie chart</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            title="Configure pie chart"
            aria-label="Configure pie chart"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 px-3">
          <PieChartSketch
            title={title}
            chartType={chartType}
            showCenterText={Boolean(ringText)}
            showLegend={showLegend}
            legendPosition={legendPosition}
            legendValues={legendValues}
            showCategoryCount={showCategoryCount}
            colors={previewColors(colors)}
            className="h-full w-full"
          />
        </div>
        <div className="flex flex-col items-center gap-1.5 px-3 pt-1 pb-3">
          {!(labelColumn && valueColumn) && (
            <p className="text-center text-xs text-muted-foreground">No query and columns set yet.</p>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            Configure
          </Button>
        </div>
        <PieChartSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          widgetId={node.component_id}
          settings={settings}
          onApply={applySettings}
          fileId={fileId}
          projectId={projectId}
        />
      </Card>
    );
  }

  // VIEW MODE
  if (!selectedFile) {
    return (
    <Card className="w-full h-full rounded-none overflow-auto">
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Please select a file to display the pie chart
      </div>
    </Card>
    );
  }

  if (error) {
    return (
    <Card className="w-full h-full rounded-none overflow-auto">
      <div className="flex items-center justify-center h-full text-red-600">
        Error: {error}
      </div>
    </Card>
    );
  }

  if (isLoading) {
    return (
    <Card className="w-full h-full rounded-none overflow-auto">
      <div className="flex items-center justify-center h-full">
        Loading chart data...
      </div>
    </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="w-full h-full rounded-none overflow-auto">
        <div className="flex items-center justify-center h-full text-muted-foreground">
          No data to display. Configure the query and columns in edit mode.
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full h-full rounded-none flex flex-col overflow-hidden">
      {title && (
        <CardHeader className="items-center pb-0">
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex-1 flex flex-col items-center gap-3 pb-0 min-h-0">
        <div ref={setChartArea} className="w-full min-h-0 flex-1 flex items-center justify-center">
        <ChartContainer
          config={chartConfig}
          className="w-full h-full aspect-auto max-h-[450px]"
        >
          <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel  />}
              />
            <Pie
              data={chartData}
              dataKey={valueColumn}
              nameKey={labelColumn}
              // With callouts the pie shrinks to leave room for their lines and text
              outerRadius={calloutFit ? calloutFit.radius : "80%"}
              innerRadius={chartType === 'donut' ? (calloutFit ? calloutFit.radius * DONUT_INNER_SHARE : "50%") : 0}
              label={showCallouts ? calloutLabel : false}
              labelLine={false}
              strokeWidth={5}
            >
              {chartType === 'donut' && ringText && (
                <PieLabel
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      const cx = Number(viewBox.cx) || 0;
                      const cy = Number(viewBox.cy) || 0;
                      const center = fitDonutCenter(totalValue.toLocaleString(), ringText, donutHoleRadius);
                      // dy instead of dominant-baseline, which not every browser applies to SVG text
                      return (
                        <g>
                          <text
                            x={cx}
                            y={cy + center.valueY}
                            dy="0.35em"
                            textAnchor="middle"
                            fontSize={center.valueSize}
                            className="fill-foreground font-bold"
                          >
                            {center.value}
                          </text>
                          <text
                            x={cx}
                            y={cy + center.ringY}
                            dy="0.35em"
                            textAnchor="middle"
                            fontSize={center.ringSize}
                            className="fill-muted-foreground"
                          >
                            <title>{ringText}</title>
                            {center.ring}
                          </text>
                        </g>
                      );
                    }
                  }}
                />
              )}
            </Pie>
          </PieChart>
        </ChartContainer>
        </div>
        {showLegend && legendPosition !== 'callouts' && (
          <ChartValueLegend
            items={legendItems}
            layout={legendPosition}
            values={legendValues}
            className="w-full max-h-[40%] shrink-0 overflow-y-auto"
          />
        )}
      </CardContent>
      {showCategoryCount && (
        <CardFooter className="flex-col gap-2 text-sm">
          <div className="leading-none text-muted-foreground">
            {categoryCount} categories
            {maxCategories && categoryCount > maxCategories ? `, largest ${maxCategories} shown` : ""}
          </div>
        </CardFooter>
      )}
    </Card>
  );
};

export default PieChartComponent;
