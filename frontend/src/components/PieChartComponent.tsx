"use client"

import React, { useState, useEffect } from 'react';
import { Label, Pie, PieChart } from "recharts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { executeQuery } from '../api/fileApi';
import { GridStackNode } from 'gridstack';

// Define props interface for components (extend as needed)
interface ComponentProps {
  node: GridStackNode & {
    component_id: number;
    component_name?: string;
    query?: string;
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
  selectedFile?: { id: number; [key: string]: any };
}

const PieChartComponent: React.FC<ComponentProps> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile
}) => {
  // State for edit mode
  const [query, setQuery] = useState(node.query || '');
  const [ringText, setRingText] = useState(node.ring_text || '');
  const [chartType, setChartType] = useState<'pie' | 'donut'>(node.chart_type || 'donut');
  const [title, setTitle] = useState(node.title || '');
  const [labelColumn, setLabelColumn] = useState(node.label_column || '');
  const [valueColumn, setValueColumn] = useState(node.value_column || '');

  // State for view mode
  const [chartData, setChartData] = useState<any[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with node when it changes
  useEffect(() => {
    setQuery(node.query || '');
    setRingText(node.ring_text || '');
    setChartType(node.chart_type || 'donut');
    setTitle(node.title || '');
    setLabelColumn(node.label_column || '');
    setValueColumn(node.value_column || '');
  }, [node]);

  // Fetch available columns when file changes (not on query change)
  useEffect(() => {
    if (!selectedFile?.id || !isEditMode) {
      setAvailableColumns([]);
      return;
    }
    // Don't auto-fetch columns - wait for user to click execute button
    setAvailableColumns([]);
  }, [selectedFile?.id, isEditMode]);

  // Manual query execution function
  const executeQueryManually = async () => {
    if (!selectedFile?.id || !query.trim()) {
      setError('Please select a file and enter a query');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("access_token");
      if (!token) throw new Error("No authentication token");

      // Execute query to get column information
      const result = await executeQuery(token, selectedFile.id.toString(), query);
      if (result.data && result.columns) {
        setAvailableColumns(result.columns);
      } else {
        setAvailableColumns([]);
      }
    } catch (err) {
      console.error('Error executing query:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute query');
      setAvailableColumns([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch chart data for view mode
  useEffect(() => {
    const fetchChartData = async () => {
      if (!selectedFile?.id || !query.trim() || !labelColumn || !valueColumn) {
        setChartData([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const token = localStorage.getItem("access_token");
        if (!token) throw new Error("No authentication token");

        const result = await executeQuery(token, selectedFile.id.toString(), query);

        if (result.data && Array.isArray(result.data)) {
          // Transform data for recharts
          const transformedData = result.data.map((row: any, index: number) => ({
            [labelColumn]: row[labelColumn],
            [valueColumn]: parseFloat(row[valueColumn]) || 0,
            fill: `var(--chart-${(index % 5) + 1})`
          }));
          setChartData(transformedData);
        } else {
          setChartData([]);
        }
      } catch (err) {
        console.error('Error fetching chart data:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch chart data');
        setChartData([]);
      } finally {
        setIsLoading(false);
      }
    };

    if (!isEditMode && selectedFile?.id && query.trim() && labelColumn && valueColumn) {
      fetchChartData();
    }
  }, [selectedFile?.id, query, labelColumn, valueColumn, isEditMode]);

  // Handlers for edit mode changes
  const handleQueryChange = (value: string) => {
    setQuery(value);
    onUpdate?.({ query: value });
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
      const key = item[labelColumn];
      config[key] = {
        label: key,
        color: `var(--chart-${(index % 5) + 1})`,
      };
    });

    return config;
  }, [chartData, labelColumn, valueColumn]);

  const totalValue = React.useMemo(() => {
    return chartData.reduce((acc, curr) => acc + (curr[valueColumn] || 0), 0);
  }, [chartData, valueColumn]);

  if (isEditMode) {
    return (
      <div className="p-4 space-y-4 h-full overflow-y-auto">
        <div>
          <label className="block text-sm font-medium mb-1">Chart Title</label>
          <Input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Enter chart title"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">SQL Query</label>
          <Textarea
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="SELECT name AS label, count AS value FROM data"
            rows={4}
          />
          <div className="flex gap-2 mt-2">
            <Button
              onClick={executeQueryManually}
              disabled={isLoading || !query.trim()}
              size="sm"
            >
              {isLoading ? 'Executing...' : 'Execute Query'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Click "Execute Query" to see available columns and test your query
          </p>
        </div>
        {availableColumns.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Available Columns</label>
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
              {availableColumns.join(', ')}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Label Column</label>
            <Input
              value={labelColumn}
              onChange={(e) => handleLabelColumnChange(e.target.value)}
              placeholder={availableColumns.length > 0 ? `e.g., ${availableColumns[0]}` : "Execute query first"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Value Column</label>
            <Input
              value={valueColumn}
              onChange={(e) => handleValueColumnChange(e.target.value)}
              placeholder={availableColumns.length > 1 ? `e.g., ${availableColumns[1]}` : "Execute query first"}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Chart Type</label>
          <div className="flex gap-2">
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

        

        
      </div>
    );
  }

  // VIEW MODE
  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Please select a file to display the pie chart
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-600">
        Error: {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        Loading chart data...
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No data to display. Configure the query and columns in edit mode.
      </div>
    );
  }

  return (
    <Card className="w-full h-full rounded-none flex flex-col overflow-hidden">
      {title && (
        <CardHeader className="items-center pb-0">
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel />}
              />
            <Pie
              data={chartData}
              dataKey={valueColumn}
              nameKey={labelColumn}
              innerRadius={chartType === 'donut' ? 60 : 0}
              strokeWidth={5}
            >
              {chartType === 'donut' && ringText && (
                <Label
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
                            className="fill-muted-foreground"
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