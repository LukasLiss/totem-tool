/**
 * BarChartComponent — one bar per result row. The query supplies a label
 * column and a numeric value column; the widget can draw bars vertically
 * or horizontally and optionally print the value on each bar.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { BAR_CHART_DEFAULT_QUERY, BAR_CHART_EXPECTED_RESULT } from "./constants";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import {
  ColumnInput,
  QuerySection,
  WidgetMessage,
} from "./shared";
import {
  firstNumericColumn,
  linkedQueryOf,
  toNumber,
  useColumnDiscovery,
  type SqlWidgetNodeFields,
  type SqlWidgetProps,
} from "./sqlWidgetUtils";

export interface BarChartNodeFields extends SqlWidgetNodeFields {
  label_column?: string;
  value_column?: string;
  horizontal?: boolean;
  show_values?: boolean;
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

  useEffect(() => {
    setTitle(node.title ?? "");
    setQuery(node.query ?? BAR_CHART_DEFAULT_QUERY);
    setLinked(linkedQueryOf(node));
    setLabelColumn(node.label_column ?? "");
    setValueColumn(node.value_column ?? "");
    setHorizontal(node.horizontal ?? false);
    setShowValues(node.show_values ?? false);
  }, [node]);

  const patch = (updates: Record<string, unknown>) => onUpdate?.(updates);
  const fileId = selectedFile?.id;
  const projectId = selectedFile?.project;
  const discovery = useColumnDiscovery(fileId, query, linked?.id);

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
    const chartData = data.rows.map((r) => ({
      label: r[labelKey] == null ? "NULL" : String(r[labelKey]),
      value: toNumber(r[valueKey]) ?? 0,
    }));
    return { chartData, valueKey };
  }, [data.rows, data.columns, labelColumn, valueColumn]);

  const chartConfig: ChartConfig = useMemo(
    () => ({ value: { label: valueKey || "value", color: "var(--chart-1)" } }),
    [valueKey]
  );

  if (isEditMode) {
    return (
      <Card className="h-full w-full overflow-auto rounded-none">
        <CardHeader>
          <CardTitle>Bar Chart (by SQL)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`bar-title-${node.component_id}`}>Title</Label>
            <Input
              id={`bar-title-${node.component_id}`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                patch({ title: e.target.value });
              }}
              placeholder="Events per activity"
            />
          </div>
          <QuerySection
            widgetId={node.component_id}
            query={query}
            onQueryChange={(q) => {
              setQuery(q);
              patch({ query: q });
            }}
            linkedQuery={linked}
            onLinkChange={(l) => {
              setLinked(l);
              patch({ query_asset: l?.id ?? null, query_asset_name: l?.name ?? null });
            }}
            fileId={fileId}
            projectId={projectId}
            expectedResult={BAR_CHART_EXPECTED_RESULT}
            editorTitle="Bar chart query"
            discovery={discovery}
          />
          <div className="grid grid-cols-2 gap-3">
            <ColumnInput
              id={`bar-label-${node.component_id}`}
              label="Label column"
              value={labelColumn}
              onChange={(v) => {
                setLabelColumn(v);
                patch({ label_column: v });
              }}
              columns={discovery.columns}
              placeholder="first text column"
            />
            <ColumnInput
              id={`bar-value-${node.component_id}`}
              label="Value column"
              value={valueColumn}
              onChange={(v) => {
                setValueColumn(v);
                patch({ value_column: v });
              }}
              columns={discovery.columns}
              placeholder="first numeric column"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`bar-horizontal-${node.component_id}`}>Horizontal bars</Label>
            <Switch
              id={`bar-horizontal-${node.component_id}`}
              checked={horizontal}
              onCheckedChange={(v) => {
                setHorizontal(v);
                patch({ horizontal: v });
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`bar-values-${node.component_id}`}>Show values on bars</Label>
            <Switch
              id={`bar-values-${node.component_id}`}
              checked={showValues}
              onCheckedChange={(v) => {
                setShowValues(v);
                patch({ show_values: v });
              }}
            />
          </div>
        </CardContent>
      </Card>
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
      {title && (
        <CardHeader className="pb-0">
          <CardTitle className="truncate text-sm">{title}</CardTitle>
        </CardHeader>
      )}
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
            <Bar dataKey="value" fill="var(--color-value)" radius={4} name={valueKey}>
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
