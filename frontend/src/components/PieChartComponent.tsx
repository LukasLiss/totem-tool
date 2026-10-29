"use client"

import React, { useState, useEffect } from 'react';
import { Label as PieLabel, Pie, PieChart, type PieLabelRenderProps } from "recharts";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { GridStackNode } from 'gridstack';
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { ColumnInput, QuerySection } from "@/components/sql-widgets/shared";
import { linkedQueryOf, useColumnDiscovery } from "@/components/sql-widgets/sqlWidgetUtils";
import { PIE_CHART_EXPECTED_RESULT } from "@/components/sql-widgets/constants";
import { ChartValueLegend, PieCallout } from "@/components/sql-widgets/chartLegend";
import {
  fitPieCallouts,
  type ChartStyle,
  type LegendPosition,
  type LegendValues,
} from "@/components/sql-widgets/chartLegendUtils";
import PieChartSketch from "./PieChartSketch";
import { SelectedFile } from '@/contexts/SelectedFileContext';

// Matches the `max-h-[450px]` of the chart container below.
const CHART_MAX_HEIGHT = 450;
// Donut hole size relative to the outer radius (recharts' 50% / 80% defaults).
const DONUT_INNER_SHARE = 0.625;


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
  }, [node]);

  const fileId = selectedFile?.id;
  const projectId = selectedFile?.project;
  const discovery = useColumnDiscovery(fileId, query, linked?.id);
  const availableColumns = discovery.columns;

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
  const chartData = React.useMemo(
    () =>
      labelColumn && valueColumn
        ? data.rows.map((row, index): Record<string, unknown> => ({
            [labelColumn]: row[labelColumn],
            [valueColumn]: parseFloat(String(row[valueColumn])) || 0,
            fill: `var(--chart-${(index % 5) + 1})`,
          }))
        : [],
    [data.rows, labelColumn, valueColumn]
  );

  // Handlers for edit mode changes
  const handleQueryChange = (value: string) => {
    setQuery(value);
    onUpdate?.({ query: value });
  };

  const handleLinkChange = (link: LinkedQuery | null) => {
    setLinked(link);
    onUpdate?.({ query_asset: link?.id ?? null, query_asset_name: link?.name ?? null });
  };

  const handleRingTextChange = (value: string) => {
    setRingText(value);
    onUpdate?.({ ring_text: value });
  };

  const handleChartTypeChange = (value: 'pie' | 'donut') => {
    setChartType(value);
    onUpdate?.({ chart_type: value });
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    onUpdate?.({ title: value });
  };


  const handleLabelColumnChange = (value: string) => {
    setLabelColumn(value);
    onUpdate?.({ label_column: value });
  };

  const handleValueColumnChange = (value: string) => {
    setValueColumn(value);
    onUpdate?.({ value_column: value });
  };

  const handleShowLegendChange = (value: boolean) => {
    setShowLegend(value);
    onUpdate?.({ show_legend: value });
  };

  const handleShowCategoryCountChange = (value: boolean) => {
    setShowCategoryCount(value);
    onUpdate?.({ chart_style: { ...node.chart_style, show_category_count: value } });
  };

  const updateLegendStyle = (legend: NonNullable<ChartStyle['legend']>) => {
    if (legend.position) setLegendPosition(legend.position);
    if (legend.values) setLegendValues(legend.values);
    onUpdate?.({
      chart_style: {
        ...node.chart_style,
        legend: { ...node.chart_style?.legend, ...legend },
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

    chartData.forEach((item, index) => {
      const key = String(item[labelColumn]);
      config[key] = {
        label: key,
        color: `var(--chart-${(index % 5) + 1})`,
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
    return (
      <Card className="w-full h-full rounded-none overflow-auto">
        <CardHeader>
          <CardTitle>Pie Chart Component</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Chart Title</label>
            <Input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Enter chart title"
            />
          </div>
          <QuerySection
            widgetId={node.component_id}
            query={query}
            onQueryChange={handleQueryChange}
            linkedQuery={linked}
            onLinkChange={handleLinkChange}
            fileId={fileId}
            projectId={projectId}
            expectedResult={PIE_CHART_EXPECTED_RESULT}
            editorTitle="Pie chart query"
            discovery={discovery}
          />
          <div className="grid grid-cols-2 gap-4">
            <ColumnInput
              id={`pie-label-${node.component_id}`}
              label="Label column"
              value={labelColumn}
              onChange={handleLabelColumnChange}
              columns={availableColumns}
              placeholder={availableColumns[0] ? `e.g. ${availableColumns[0]}` : "detect columns first"}
            />
            <ColumnInput
              id={`pie-value-${node.component_id}`}
              label="Value column"
              value={valueColumn}
              onChange={handleValueColumnChange}
              columns={availableColumns}
              placeholder={availableColumns[1] ? `e.g. ${availableColumns[1]}` : "detect columns first"}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Chart Type</label>
            <div className="flex justify-center gap-2">
              <Button
                variant={chartType === 'pie' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleChartTypeChange('pie')}
              >
                Pie Chart
              </Button>
              <Button
                variant={chartType === 'donut' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleChartTypeChange('donut')}
              >
                Donut Chart
              </Button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Center Text (Donut)</label>
            <Input
              value={ringText}
              onChange={(e) => handleRingTextChange(e.target.value)}
              placeholder="Center text for donut chart"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`pie-category-count-${node.component_id}`}>Show number of categories</Label>
            <Switch
              id={`pie-category-count-${node.component_id}`}
              checked={showCategoryCount}
              onCheckedChange={handleShowCategoryCountChange}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`pie-legend-${node.component_id}`}>Show legend</Label>
            <Switch
              id={`pie-legend-${node.component_id}`}
              checked={showLegend}
              onCheckedChange={handleShowLegendChange}
            />
          </div>
          {showLegend && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Legend Style</label>
                <div className="flex justify-center gap-2">
                  {([['bottom', 'Bottom'], ['columns', 'Columns'], ['callouts', 'Callouts']] as const).map(([value, text]) => (
                    <Button
                      key={value}
                      variant={legendPosition === value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateLegendStyle({ position: value })}
                    >
                      {text}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Legend Values</label>
                <div className="flex justify-center gap-2">
                  {([['none', 'None'], ['value', 'Value'], ['percent', 'Percent'], ['both', 'Both']] as const).map(([value, text]) => (
                    <Button
                      key={value}
                      variant={legendValues === value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateLegendStyle({ values: value })}
                    >
                      {text}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="border-t pt-4">
            <PieChartSketch
              title={title}
              chartType={chartType}
              showCenterText={Boolean(ringText)}
              showLegend={showLegend}
              legendPosition={legendPosition}
              legendValues={legendValues}
              showCategoryCount={showCategoryCount}
            />
          </div>

        </CardContent>
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
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-3xl font-bold"
                          >
                            {totalValue.toLocaleString()}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy || 0) + 24}
                            className="fill-muted-foreground break-normal"
                          >
                            {ringText}
                          </tspan>
                        </text>
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
            {chartData.length} categories
          </div>
        </CardFooter>
      )}
    </Card>
  );
};

export default PieChartComponent;
