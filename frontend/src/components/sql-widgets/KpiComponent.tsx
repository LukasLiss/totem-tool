/**
 * KpiComponent — a single number computed by a SQL query. Reads the first
 * row's `value_column` (or its first column) and renders it large, with an
 * optional prefix / suffix and a fixed number of decimals.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { KPI_DEFAULT_QUERY, KPI_EXPECTED_RESULT } from "./constants";
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

export interface KpiNodeFields extends SqlWidgetNodeFields {
  value_column?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}



const KpiComponent: React.FC<SqlWidgetProps<KpiNodeFields>> = ({
  node,
  onUpdate,
  isEditMode = false,
  selectedFile,
}) => {
  const [title, setTitle] = useState(node.title ?? "");
  const [query, setQuery] = useState(node.query ?? KPI_DEFAULT_QUERY);
  const [linked, setLinked] = useState<LinkedQuery | null>(linkedQueryOf(node));
  const [valueColumn, setValueColumn] = useState(node.value_column ?? "");
  const [prefix, setPrefix] = useState(node.prefix ?? "");
  const [suffix, setSuffix] = useState(node.suffix ?? "");
  const [decimals, setDecimals] = useState(node.decimals ?? 0);

  useEffect(() => {
    setTitle(node.title ?? "");
    setQuery(node.query ?? KPI_DEFAULT_QUERY);
    setLinked(linkedQueryOf(node));
    setValueColumn(node.value_column ?? "");
    setPrefix(node.prefix ?? "");
    setSuffix(node.suffix ?? "");
    setDecimals(node.decimals ?? 0);
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
    limit: 1,
  });

  const value = useMemo(() => {
    if (data.rows.length === 0) return null;
    const column = valueColumn || firstNumericColumn(data.rows, data.columns) || data.columns[0];
    if (!column) return null;
    return { column, raw: data.rows[0][column] };
  }, [data.rows, data.columns, valueColumn]);

  if (isEditMode) {
    return (
      <Card className="h-full w-full overflow-auto rounded-none">
        <CardHeader>
          <CardTitle>KPI (by SQL)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`kpi-title-${node.component_id}`}>Title</Label>
            <Input
              id={`kpi-title-${node.component_id}`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                patch({ title: e.target.value });
              }}
              placeholder="Number of events"
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
            expectedResult={KPI_EXPECTED_RESULT}
            editorTitle="KPI query"
            discovery={discovery}
          />
          <div className="grid grid-cols-2 gap-3">
            <ColumnInput
              id={`kpi-value-${node.component_id}`}
              label="Value column"
              value={valueColumn}
              onChange={(v) => {
                setValueColumn(v);
                patch({ value_column: v });
              }}
              columns={discovery.columns}
              placeholder="first column"
              hint="Leave empty to use the first column."
            />
            <div className="grid gap-1.5">
              <Label htmlFor={`kpi-decimals-${node.component_id}`}>Decimals</Label>
              <Input
                id={`kpi-decimals-${node.component_id}`}
                type="number"
                min={0}
                max={10}
                value={decimals}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(10, Number(e.target.value) || 0));
                  setDecimals(n);
                  patch({ decimals: n });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`kpi-prefix-${node.component_id}`}>Prefix</Label>
              <Input
                id={`kpi-prefix-${node.component_id}`}
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value);
                  patch({ prefix: e.target.value });
                }}
                placeholder="€"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`kpi-suffix-${node.component_id}`}>Suffix</Label>
              <Input
                id={`kpi-suffix-${node.component_id}`}
                value={suffix}
                onChange={(e) => {
                  setSuffix(e.target.value);
                  patch({ suffix: e.target.value });
                }}
                placeholder="events"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!fileId) return <WidgetMessage>Select an event log to compute this KPI.</WidgetMessage>;
  if (data.error) return <WidgetMessage tone="error">{data.error}</WidgetMessage>;
  if (data.loading) return <WidgetMessage>Loading…</WidgetMessage>;
  if (!value) return <WidgetMessage>The query returned no rows.</WidgetMessage>;

  const numeric = toNumber(value.raw);
  const formatted =
    numeric != null
      ? numeric.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : value.raw == null
        ? "NULL"
        : String(value.raw);

  return (
    <Card className="flex h-full w-full flex-col overflow-hidden rounded-none">
      {title && (
        <CardHeader className="pb-0">
          <CardTitle className="truncate text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-4">
        <div className="flex items-baseline gap-1 whitespace-nowrap">
          {prefix && <span className="text-lg text-muted-foreground">{prefix}</span>}
          <span
            className="font-semibold tabular-nums tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 12cqw, 3.5rem)", lineHeight: 1.1 }}
            title={value.column}
          >
            {formatted}
          </span>
          {suffix && <span className="text-lg text-muted-foreground">{suffix}</span>}
        </div>
        {!title && <span className="font-mono text-[11px] text-muted-foreground">{value.column}</span>}
      </CardContent>
    </Card>
  );
};

export default KpiComponent;
