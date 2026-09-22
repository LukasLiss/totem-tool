/**
 * ScatterPlotComponent — one point per result row from numeric x / y
 * columns, optionally colored by a series column.
 */

import React, { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { SCATTER_DEFAULT_QUERY, SCATTER_EXPECTED_RESULT } from "./constants";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import {
  ColumnInput,
  QuerySection,
  WidgetMessage,
} from "./shared";
import {
  linkedQueryOf,
  toNumber,
  useColumnDiscovery,
  type SqlWidgetNodeFields,
  type SqlWidgetProps,
} from "./sqlWidgetUtils";

export interface ScatterPlotNodeFields extends SqlWidgetNodeFields {
  x_column?: string;
  y_column?: string;
  series_column?: string;
  x_label?: string;
  y_label?: string;
}



const SERIES_COLORS = 5;
const MAX_SERIES = 12;

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

  useEffect(() => {
    setTitle(node.title ?? "");
    setQuery(node.query ?? SCATTER_DEFAULT_QUERY);
    setLinked(linkedQueryOf(node));
    setXColumn(node.x_column ?? "");
    setYColumn(node.y_column ?? "");
    setSeriesColumn(node.series_column ?? "");
    setXLabel(node.x_label ?? "");
    setYLabel(node.y_label ?? "");
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
    limit: 5000,
  });

  const { series, xKey, yKey, seriesKey, config } = useMemo(() => {
    const numericCols = data.columns.filter((c) =>
      data.rows.some((r) => toNumber(r[c]) != null)
    );
    const xKey = xColumn || numericCols[0] || data.columns[0] || "";
    const yKey = yColumn || numericCols.find((c) => c !== xKey) || data.columns[1] || "";
    const seriesKey = seriesColumn || "";
    const groups = new Map<string, { x: number; y: number }[]>();
    for (const r of data.rows) {
      const x = toNumber(r[xKey]);
      const y = toNumber(r[yKey]);
      if (x == null || y == null) continue;
      const key = seriesKey ? (r[seriesKey] == null ? "NULL" : String(r[seriesKey])) : "points";
      if (!groups.has(key)) {
        if (groups.size >= MAX_SERIES) continue;
        groups.set(key, []);
      }
      groups.get(key)!.push({ x, y });
    }
    const series = Array.from(groups.entries()).map(([name, points], i) => ({
      name,
      points,
      color: `var(--chart-${(i % SERIES_COLORS) + 1})`,
    }));
    const config: ChartConfig = {};
    series.forEach((s) => {
      config[s.name] = { label: s.name, color: s.color };
    });
    return { series, xKey, yKey, seriesKey, config };
  }, [data.rows, data.columns, xColumn, yColumn, seriesColumn]);

  if (isEditMode) {
    return (
      <Card className="h-full w-full overflow-auto rounded-none">
        <CardHeader>
          <CardTitle>Scatter Plot (by SQL)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`scatter-title-${node.component_id}`}>Title</Label>
            <Input
              id={`scatter-title-${node.component_id}`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                patch({ title: e.target.value });
              }}
              placeholder="Events vs. distinct activities per object"
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
            expectedResult={SCATTER_EXPECTED_RESULT}
            editorTitle="Scatter plot query"
            discovery={discovery}
          />
          <div className="grid grid-cols-2 gap-3">
            <ColumnInput
              id={`scatter-x-${node.component_id}`}
              label="X column"
              value={xColumn}
              onChange={(v) => {
                setXColumn(v);
                patch({ x_column: v });
              }}
              columns={discovery.columns}
              placeholder="first numeric column"
            />
            <ColumnInput
              id={`scatter-y-${node.component_id}`}
              label="Y column"
              value={yColumn}
              onChange={(v) => {
                setYColumn(v);
                patch({ y_column: v });
              }}
              columns={discovery.columns}
              placeholder="second numeric column"
            />
            <ColumnInput
              id={`scatter-series-${node.component_id}`}
              label="Series column (optional)"
              value={seriesColumn}
              onChange={(v) => {
                setSeriesColumn(v);
                patch({ series_column: v });
              }}
              columns={discovery.columns}
              placeholder="none"
              hint={`Up to ${MAX_SERIES} distinct values are colored.`}
            />
            <div className="grid gap-1.5">
              <Label htmlFor={`scatter-xlabel-${node.component_id}`}>Axis labels</Label>
              <Input
                id={`scatter-xlabel-${node.component_id}`}
                value={xLabel}
                onChange={(e) => {
                  setXLabel(e.target.value);
                  patch({ x_label: e.target.value });
                }}
                placeholder="x axis"
              />
              <Input
                aria-label="y axis label"
                value={yLabel}
                onChange={(e) => {
                  setYLabel(e.target.value);
                  patch({ y_label: e.target.value });
                }}
                placeholder="y axis"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!fileId) return <WidgetMessage>Select an event log to draw this plot.</WidgetMessage>;
  if (data.error) return <WidgetMessage tone="error">{data.error}</WidgetMessage>;
  if (data.loading) return <WidgetMessage>Loading…</WidgetMessage>;
  if (series.length === 0) {
    return <WidgetMessage>No numeric points to display. Configure the query and columns in edit mode.</WidgetMessage>;
  }

  return (
    <Card className="flex h-full w-full flex-col overflow-hidden rounded-none">
      {title && (
        <CardHeader className="pb-0">
          <CardTitle className="truncate text-sm">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1 p-3">
        <ChartContainer config={config} className="aspect-auto h-full w-full">
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
            <ZAxis range={[36, 36]} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={<ChartTooltipContent hideLabel={!seriesKey} />}
            />
            {seriesKey && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s) => (
              <Scatter key={s.name} name={s.name} data={s.points} fill={s.color} />
            ))}
          </ScatterChart>
        </ChartContainer>
        {data.truncated && (
          <p className="pt-1 text-[11px] text-muted-foreground">showing the first 5,000 rows</p>
        )}
      </CardContent>
    </Card>
  );
};

export default ScatterPlotComponent;
