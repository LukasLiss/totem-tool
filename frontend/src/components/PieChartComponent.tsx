"use client"

import React, { useState, useEffect } from 'react';
import { Label as PieLabel, Pie, PieChart } from "recharts";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GridStackNode } from 'gridstack';
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { ColumnInput, QuerySection } from "@/components/sql-widgets/shared";
import { linkedQueryOf, useColumnDiscovery } from "@/components/sql-widgets/sqlWidgetUtils";
import { PIE_CHART_EXPECTED_RESULT } from "@/components/sql-widgets/constants";


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
  };
  onUpdate?: (updates: Partial<GridStackNode> & Record<string, any>) => void;
  isEditMode?: boolean;
  dashboardId: number;
  selectedFile?: { id: number; project?: number; [key: string]: any };
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

  // Sync with node when it changes
  useEffect(() => {
    setQuery(node.query || '');
    setLinked(linkedQueryOf(node));
    setRingText(node.ring_text || '');
    setChartType(node.chart_type || 'donut');
    setTitle(node.title || '');
    setLabelColumn(node.label_column || '');
    setValueColumn(node.value_column || '');
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
      <CardContent className="flex-1 flex justify-center items-center pb-0 min-h-0">
        <ChartContainer
          config={chartConfig}
          className="w-full h-full max-h-[450px]"
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
              innerRadius={chartType === 'donut' ? "50%" : 0}
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
      </CardContent>
        <CardFooter className="flex-col gap-2 text-sm">
          <div className="leading-none text-muted-foreground">
            {chartData.length} categories
          </div>
        </CardFooter>
    </Card>
  );
};

export default PieChartComponent;