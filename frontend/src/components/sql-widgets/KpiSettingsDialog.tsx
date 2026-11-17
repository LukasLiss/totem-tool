/**
 * KpiSettingsDialog — the KPI widget's settings in a modal popup, built like
 * the chart popups: a Data tab (query and value column) and a Style tab
 * (prefix, suffix, decimals) beside a draft of the number. Changes are kept
 * as a draft and only reach the widget on Apply.
 */

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { discoveryKey, useColumnDiscovery } from "./sqlWidgetUtils";
import { KPI_EXPECTED_RESULT } from "./constants";
import {
  ChartDataTab,
  ChartSettingsDialog,
  ChartSettingsLayout,
  SettingRow,
  type ChartSettingsTab,
} from "./chartSettings";
import { useDiscoverOnOpen } from "./chartSettingsUtils";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { formatKpiValue, pickKpiValue } from "./kpiUtils";
import KpiSketch from "./KpiSketch";

export interface KpiSettings {
  title: string;
  query: string;
  linked: LinkedQuery | null;
  /** Empty: the first numeric column. */
  valueColumn: string;
  prefix: string;
  suffix: string;
  decimals: number;
}

// Matches the backend's bound for the decimals column.
const MAX_DECIMALS = 10;

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel, fileId, projectId }: {
  widgetId: number;
  initial: KpiSettings;
  onApply: (settings: KpiSettings) => void;
  onCancel: () => void;
  fileId?: number;
  projectId?: number;
}) {
  const idPrefix = `kpi-${widgetId}`;
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<ChartSettingsTab>(initial.query.trim() || initial.linked ? "style" : "data");
  const set = <K extends keyof KpiSettings>(key: K, value: KpiSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const discovery = useColumnDiscovery(fileId, draft.query, draft.linked?.id);
  useDiscoverOnOpen(discovery, fileId, initial.query, initial.linked);

  // The real value for the draft, like the bar chart's categories: loaded on
  // the Style tab (so typing a query doesn't run it on every key). On the
  // Data tab, a result that is already there is used instead: from opening
  // the popup, "Detect columns" or a run in the SQL editor.
  const result = useSqlQueryData({
    fileId,
    query: draft.query,
    queryAssetId: draft.linked?.id,
    enabled: tab === "style",
    limit: 1,
  });
  const detectedMatches = discovery.resultFor === discoveryKey(draft.query, draft.linked?.id);
  const value =
    tab === "style" && !result.loading && !result.error
      ? pickKpiValue(result.rows, result.columns, draft.valueColumn)
      : detectedMatches
        ? pickKpiValue(discovery.rows, discovery.columns, draft.valueColumn)
        : null;

  return (
    <ChartSettingsLayout
      heading="KPI settings"
      idPrefix={idPrefix}
      title={draft.title}
      onTitleChange={(title) => set("title", title)}
      tab={tab}
      onTabChange={setTab}
      onApply={() => onApply(draft)}
      onCancel={onCancel}
      dataTab={
        <ChartDataTab
          widgetId={widgetId}
          idPrefix={idPrefix}
          query={draft.query}
          onQueryChange={(q) => set("query", q)}
          linked={draft.linked}
          onLinkChange={(l) => set("linked", l)}
          columnFields={[
            {
              key: "value",
              label: "Value column",
              value: draft.valueColumn,
              onChange: (v) => set("valueColumn", v),
              autoLabel: "Automatic (first numeric column)",
            },
          ]}
          fileId={fileId}
          projectId={projectId}
          expectedResult={KPI_EXPECTED_RESULT}
          editorTitle="KPI query"
          discovery={discovery}
        />
      }
      styleTab={
        <>
          <SettingRow label="Prefix" htmlFor={`${idPrefix}-prefix`}>
            <Input
              id={`${idPrefix}-prefix`}
              value={draft.prefix}
              onChange={(e) => set("prefix", e.target.value)}
              placeholder="e.g. €"
              className="h-8 max-w-56"
            />
          </SettingRow>
          <SettingRow label="Suffix" htmlFor={`${idPrefix}-suffix`}>
            <Input
              id={`${idPrefix}-suffix`}
              value={draft.suffix}
              onChange={(e) => set("suffix", e.target.value)}
              placeholder="e.g. events"
              className="h-8 max-w-56"
            />
          </SettingRow>
          <SettingRow label="Decimals" htmlFor={`${idPrefix}-decimals`}>
            <Input
              id={`${idPrefix}-decimals`}
              type="number"
              min={0}
              max={MAX_DECIMALS}
              step={1}
              inputMode="numeric"
              value={draft.decimals}
              onChange={(e) =>
                set("decimals", Math.max(0, Math.min(MAX_DECIMALS, parseInt(e.target.value, 10) || 0)))
              }
              className="h-8 w-20"
            />
          </SettingRow>
        </>
      }
      sketch={
        <KpiSketch
          title={draft.title}
          prefix={draft.prefix}
          suffix={draft.suffix}
          decimals={draft.decimals}
          value={value ? formatKpiValue(value.raw, draft.decimals) : undefined}
          column={value?.column}
          className="w-full max-w-xs md:max-w-md"
        />
      }
      sketchHint={
        value
          ? "Preview with the query's current result, formatted with your settings."
          : result.loading || discovery.loading
            ? "Loading the current value…"
            : "A sample number formatted with your settings. The query's real value appears " +
              "once it has run: on the Style tab, with “Detect columns”, or via Run in the SQL editor."
      }
    />
  );
}

const KpiSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  settings: KpiSettings;
  onApply: (settings: KpiSettings) => void;
  fileId?: number;
  projectId?: number;
}> = ({ open, onOpenChange, widgetId, settings, onApply, fileId, projectId }) => (
  <ChartSettingsDialog open={open} onOpenChange={onOpenChange}>
    <SettingsBody
      widgetId={widgetId}
      initial={settings}
      onApply={(next) => {
        onApply(next);
        onOpenChange(false);
      }}
      onCancel={() => onOpenChange(false)}
      fileId={fileId}
      projectId={projectId}
    />
  </ChartSettingsDialog>
);

export default KpiSettingsDialog;
