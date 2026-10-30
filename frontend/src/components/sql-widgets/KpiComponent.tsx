/**
 * KpiComponent — a single number computed by a SQL query. Reads the first
 * row's `value_column` (or its first column) and renders it large, with an
 * optional prefix / suffix and a fixed number of decimals. In edit mode the
 * tile shows a draft of the number and the settings open in a popup.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { KPI_DEFAULT_QUERY } from "./constants";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { WidgetMessage } from "./shared";
import { linkedQueryOf, type SqlWidgetNodeFields, type SqlWidgetProps } from "./sqlWidgetUtils";
import { formatKpiValue, pickKpiValue } from "./kpiUtils";
import WidgetDraftTile from "@/components/WidgetDraftTile";
import KpiSketch from "./KpiSketch";
import KpiSettingsDialog, { type KpiSettings } from "./KpiSettingsDialog";

export interface KpiNodeFields extends SqlWidgetNodeFields {
  value_column?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

// Shown when hovering the draft in edit mode.
const KPI_SKETCH_HINT =
  "Preview of the KPI: your title, prefix and suffix around the query's current value (a " +
  "faded sample number until it is loaded), formatted with the chosen decimals.";

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
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setTitle(node.title ?? "");
    setQuery(node.query ?? KPI_DEFAULT_QUERY);
    setLinked(linkedQueryOf(node));
    setValueColumn(node.value_column ?? "");
    setPrefix(node.prefix ?? "");
    setSuffix(node.suffix ?? "");
    setDecimals(node.decimals ?? 0);
  }, [node]);

  const fileId = selectedFile?.id;
  const projectId = selectedFile?.project;

  const settings: KpiSettings = { title, query, linked, valueColumn, prefix, suffix, decimals };

  const applySettings = (next: KpiSettings) => {
    setTitle(next.title);
    setQuery(next.query);
    setLinked(next.linked);
    setValueColumn(next.valueColumn);
    setPrefix(next.prefix);
    setSuffix(next.suffix);
    setDecimals(next.decimals);
    onUpdate?.({
      title: next.title,
      query: next.query,
      query_asset: next.linked?.id ?? null,
      query_asset_name: next.linked?.name ?? null,
      value_column: next.valueColumn,
      prefix: next.prefix,
      suffix: next.suffix,
      decimals: next.decimals,
    });
  };

  // Runs in edit mode too (one row is cheap), so the draft tile shows the real value.
  const data = useSqlQueryData({
    fileId,
    query,
    queryAssetId: linked?.id,
    limit: 1,
  });

  const value = useMemo(
    () => pickKpiValue(data.rows, data.columns, valueColumn),
    [data.rows, data.columns, valueColumn]
  );

  if (isEditMode) {
    return (
      <WidgetDraftTile
        typeLabel="KPI"
        hint={KPI_SKETCH_HINT}
        notice={query.trim() || linked ? undefined : "No query set yet."}
        onConfigure={() => setSettingsOpen(true)}
        sketch={
          <KpiSketch
            title={title}
            prefix={prefix}
            suffix={suffix}
            decimals={decimals}
            // The sample number until the value is loaded (or without an event log / on an error).
            value={value && !data.loading && !data.error ? formatKpiValue(value.raw, decimals) : undefined}
            column={value?.column}
            className="h-full w-full"
          />
        }
      >
        <KpiSettingsDialog
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

  if (!fileId) return <WidgetMessage>Select an event log to compute this KPI.</WidgetMessage>;
  if (data.error) return <WidgetMessage tone="error">{data.error}</WidgetMessage>;
  if (data.loading) return <WidgetMessage>Loading…</WidgetMessage>;
  if (!value) return <WidgetMessage>The query returned no rows.</WidgetMessage>;

  const formatted = formatKpiValue(value.raw, decimals);

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
