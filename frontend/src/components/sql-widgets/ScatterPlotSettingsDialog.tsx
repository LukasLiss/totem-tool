/**
 * ScatterPlotSettingsDialog — the scatter plot widget's settings in a modal
 * popup, built like the other chart popups: a Data tab (query, x / y and
 * series columns) and a Style tab (axis labels, legend, max series, colors)
 * beside a layout sketch. Changes are kept as a draft and only reach the
 * widget on Apply.
 */

import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { SegmentedControl } from "./shared";
import { useColumnDiscovery } from "./sqlWidgetUtils";
import { SCATTER_EXPECTED_RESULT } from "./constants";
import { previewColors, type ChartColors } from "./chartColors";
import type { LegendPosition, PointSize } from "./chartLegendUtils";
import {
  ChartDataTab,
  ChartSettingsDialog,
  ChartSettingsLayout,
  ColorSettings,
  MaxCategoriesRow,
  SettingRow,
  type ChartSettingsTab,
} from "./chartSettings";
import { useDiscoverOnOpen, type CategoryList } from "./chartSettingsUtils";
import { DEFAULT_MAX_SERIES, buildScatterSeries, scatterColors } from "./scatterUtils";
import ScatterPlotSketch from "./ScatterPlotSketch";

export interface ScatterPlotSettings {
  title: string;
  query: string;
  linked: LinkedQuery | null;
  xColumn: string;
  yColumn: string;
  /** Empty: no series, all points in one color. */
  seriesColumn: string;
  xLabel: string;
  yLabel: string;
  legendPosition: LegendPosition;
  pointSize: PointSize;
  transparentPoints: boolean;
  colors: ChartColors;
  /** Series with their own color, the rest grouped as "Other"; null = DEFAULT_MAX_SERIES. */
  maxSeries: number | null;
}

const POINT_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
] as const;

const LEGEND_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bottom", label: "Bottom" },
  { value: "columns", label: "Columns" },
] as const;

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel, fileId, projectId }: {
  widgetId: number;
  initial: ScatterPlotSettings;
  onApply: (settings: ScatterPlotSettings) => void;
  onCancel: () => void;
  fileId?: number;
  projectId?: number;
}) {
  const idPrefix = `scatter-${widgetId}`;
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<ChartSettingsTab>(initial.query.trim() || initial.linked ? "style" : "data");
  const set = <K extends keyof ScatterPlotSettings>(key: K, value: ScatterPlotSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const discovery = useColumnDiscovery(fileId, draft.query, draft.linked?.id);
  useDiscoverOnOpen(discovery, fileId, initial.query, initial.linked);

  const hasSeries = draft.seriesColumn !== "";
  const colors = scatterColors(draft.colors, hasSeries);

  // The real series, for per-series colors; only loaded on the Style tab.
  const result = useSqlQueryData({
    fileId,
    query: draft.query,
    queryAssetId: draft.linked?.id,
    enabled: tab === "style" && hasSeries,
    limit: 5000,
  });
  const categories: CategoryList = useMemo(
    () => ({
      slices: hasSeries ? buildScatterSeries(result.rows, result.columns, draft).slices : [],
      loading: result.loading,
      error: result.error,
      needsColumns: !hasSeries,
    }),
    [hasSeries, result.rows, result.columns, result.loading, result.error, draft]
  );

  return (
    <ChartSettingsLayout
      heading="Scatter plot settings"
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
              key: "x",
              label: "X column",
              value: draft.xColumn,
              onChange: (v) => set("xColumn", v),
              autoLabel: "Automatic (first numeric column)",
            },
            {
              key: "y",
              label: "Y column",
              value: draft.yColumn,
              onChange: (v) => set("yColumn", v),
              autoLabel: "Automatic (second numeric column)",
            },
            {
              key: "series",
              label: "Series column",
              value: draft.seriesColumn,
              onChange: (v) => set("seriesColumn", v),
              autoLabel: "None (one color)",
            },
          ]}
          fileId={fileId}
          projectId={projectId}
          expectedResult={SCATTER_EXPECTED_RESULT}
          editorTitle="Scatter plot query"
          discovery={discovery}
        />
      }
      styleTab={
        <>
          <SettingRow label="X axis label" htmlFor={`${idPrefix}-x-label`}>
            <Input
              id={`${idPrefix}-x-label`}
              value={draft.xLabel}
              onChange={(e) => set("xLabel", e.target.value)}
              placeholder="e.g. events"
              className="h-8 max-w-56"
            />
          </SettingRow>
          <SettingRow label="Y axis label" htmlFor={`${idPrefix}-y-label`}>
            <Input
              id={`${idPrefix}-y-label`}
              value={draft.yLabel}
              onChange={(e) => set("yLabel", e.target.value)}
              placeholder="e.g. distinct activities"
              className="h-8 max-w-56"
            />
          </SettingRow>
          {/* Legend and max series only apply with a series column. */}
          <SettingRow label="Point size">
            <SegmentedControl
              ariaLabel="Point size"
              value={draft.pointSize}
              options={POINT_SIZE_OPTIONS}
              onChange={(v) => set("pointSize", v)}
            />
          </SettingRow>
          <SettingRow label="Transparent points" htmlFor={`${idPrefix}-transparent`}>
            <Switch
              id={`${idPrefix}-transparent`}
              checked={draft.transparentPoints}
              onCheckedChange={(v) => set("transparentPoints", v)}
            />
          </SettingRow>
          <SettingRow label="Legend" disabled={!hasSeries}>
            <SegmentedControl
              ariaLabel="Legend"
              value={draft.legendPosition === "columns" || draft.legendPosition === "none" ? draft.legendPosition : "bottom"}
              options={LEGEND_OPTIONS}
              onChange={(v) => set("legendPosition", v)}
              disabled={!hasSeries}
            />
          </SettingRow>
          <MaxCategoriesRow
            id={`${idPrefix}-max-series`}
            label="Max series"
            placeholder={String(DEFAULT_MAX_SERIES)}
            value={draft.maxSeries}
            onChange={(v) => set("maxSeries", v)}
            hint="rest grouped as “Other”"
            disabled={!hasSeries}
          />
          {!hasSeries && (
            <p className="text-xs text-muted-foreground">
              Choose a series column in the Data tab to color points by series and show a legend.
            </p>
          )}
          <ColorSettings
            idPrefix={idPrefix}
            colors={colors}
            onChange={(next) => set("colors", next)}
            categories={categories}
            singleColorLabel="Point color"
            singleOnly={!hasSeries}
          />
        </>
      }
      sketch={
        <ScatterPlotSketch
          title={draft.title}
          xLabel={draft.xLabel}
          yLabel={draft.yLabel}
          hasSeries={hasSeries}
          legendPosition={draft.legendPosition}
          pointSize={draft.pointSize}
          transparentPoints={draft.transparentPoints}
          colors={previewColors(colors, categories.slices.map((slice) => slice.label))}
          className="w-full max-w-xs md:max-w-md"
        />
      }
    />
  );
}

const ScatterPlotSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  settings: ScatterPlotSettings;
  onApply: (settings: ScatterPlotSettings) => void;
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

export default ScatterPlotSettingsDialog;
