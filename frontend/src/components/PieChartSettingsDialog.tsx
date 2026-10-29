/**
 * PieChartSettingsDialog — the pie chart widget's settings in a modal popup:
 * a Data tab (query and columns) and a Style tab (chart type, legend, values,
 * category count, colors) on the left, and a layout sketch on the right that
 * follows the settings. Changes are kept as a draft and only reach the widget
 * on Apply; Cancel, the close button or a click outside discard them. The
 * frame and shared pieces are in sql-widgets/chartSettings.tsx.
 */

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { SegmentedControl } from "@/components/sql-widgets/shared";
import { useColumnDiscovery } from "@/components/sql-widgets/sqlWidgetUtils";
import { PIE_CHART_EXPECTED_RESULT } from "@/components/sql-widgets/constants";
import type { LegendPosition, LegendValues } from "@/components/sql-widgets/chartLegendUtils";
import { previewColors, type ChartColors } from "@/components/sql-widgets/chartColors";
import {
  ChartDataTab,
  ChartSettingsDialog,
  ChartSettingsLayout,
  ColorSettings,
  MaxCategoriesRow,
  SettingRow,
  type ChartSettingsTab,
} from "@/components/sql-widgets/chartSettings";
import { useCategoryList, useDiscoverOnOpen } from "@/components/sql-widgets/chartSettingsUtils";
import PieChartSketch from "./PieChartSketch";

export interface PieChartSettings {
  title: string;
  query: string;
  linked: LinkedQuery | null;
  labelColumn: string;
  valueColumn: string;
  chartType: "pie" | "donut";
  ringText: string;
  showLegend: boolean;
  legendPosition: LegendPosition;
  legendValues: LegendValues;
  showCategoryCount: boolean;
  colors: ChartColors;
  /** Largest N categories shown, the rest grouped as "Other"; null = all. */
  maxCategories: number | null;
}

const CHART_TYPE_OPTIONS = [
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
] as const;

// "None" stands for a hidden legend (show_legend = false).
const LEGEND_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bottom", label: "Bottom" },
  { value: "columns", label: "Columns" },
  { value: "callouts", label: "Callouts" },
] as const;

const VALUE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "value", label: "Value" },
  { value: "percent", label: "Percent" },
  { value: "both", label: "Both" },
] as const;

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel, fileId, projectId }: {
  widgetId: number;
  initial: PieChartSettings;
  onApply: (settings: PieChartSettings) => void;
  onCancel: () => void;
  fileId?: number;
  projectId?: number;
}) {
  const idPrefix = `pie-${widgetId}`;
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<ChartSettingsTab>(
    initial.labelColumn && initial.valueColumn ? "style" : "data"
  );
  const set = <K extends keyof PieChartSettings>(key: K, value: PieChartSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const discovery = useColumnDiscovery(fileId, draft.query, draft.linked?.id);
  useDiscoverOnOpen(discovery, fileId, initial.query, initial.linked);

  // The real categories, for per-category colors; only loaded on the Style tab.
  const categories = useCategoryList({
    fileId,
    query: draft.query,
    linked: draft.linked,
    labelColumn: draft.labelColumn,
    valueColumn: draft.valueColumn,
    enabled: tab === "style",
    maxCategories: draft.maxCategories,
    groupRest: true,
  });

  const legend = draft.showLegend ? draft.legendPosition : "none";

  return (
    <ChartSettingsLayout
      heading="Pie chart settings"
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
          labelColumn={draft.labelColumn}
          onLabelColumnChange={(v) => set("labelColumn", v)}
          valueColumn={draft.valueColumn}
          onValueColumnChange={(v) => set("valueColumn", v)}
          fileId={fileId}
          projectId={projectId}
          expectedResult={PIE_CHART_EXPECTED_RESULT}
          editorTitle="Pie chart query"
          discovery={discovery}
        />
      }
      styleTab={
        <>
          <SettingRow label="Type">
            <SegmentedControl
              ariaLabel="Chart type"
              value={draft.chartType}
              options={CHART_TYPE_OPTIONS}
              onChange={(v) => set("chartType", v)}
            />
          </SettingRow>
          {/* Only a donut has a center; for a pie the field stays visible but disabled. */}
          <SettingRow label="Center text" htmlFor={`${idPrefix}-center`} disabled={draft.chartType !== "donut"}>
            <Input
              id={`${idPrefix}-center`}
              value={draft.ringText}
              onChange={(e) => set("ringText", e.target.value)}
              placeholder={draft.chartType === "donut" ? "e.g. events" : "Donut only"}
              disabled={draft.chartType !== "donut"}
              title={draft.chartType === "donut" ? undefined : "Only a donut chart has a center"}
              className="h-8 max-w-56"
            />
          </SettingRow>
          <SettingRow label="Legend">
            <SegmentedControl
              ariaLabel="Legend"
              value={legend}
              options={LEGEND_OPTIONS}
              onChange={(v) =>
                v === "none"
                  ? set("showLegend", false)
                  : setDraft((d) => ({ ...d, showLegend: true, legendPosition: v }))
              }
            />
          </SettingRow>
          <SettingRow label="Values">
            <SegmentedControl
              ariaLabel="Values"
              value={draft.legendValues}
              options={VALUE_OPTIONS}
              onChange={(v) => set("legendValues", v)}
              disabled={!draft.showLegend}
            />
          </SettingRow>
          <SettingRow label="Number of categories" htmlFor={`${idPrefix}-category-count`}>
            <Switch
              id={`${idPrefix}-category-count`}
              checked={draft.showCategoryCount}
              onCheckedChange={(v) => set("showCategoryCount", v)}
            />
          </SettingRow>
          <MaxCategoriesRow
            id={`${idPrefix}-max-categories`}
            value={draft.maxCategories}
            onChange={(v) => set("maxCategories", v)}
            hint="rest grouped as “Other”"
          />
          <ColorSettings
            idPrefix={idPrefix}
            colors={draft.colors}
            onChange={(colors) => set("colors", colors)}
            categories={categories}
          />
        </>
      }
      sketch={
        <PieChartSketch
          title={draft.title}
          chartType={draft.chartType}
          showCenterText={Boolean(draft.ringText)}
          showLegend={draft.showLegend}
          legendPosition={draft.legendPosition}
          legendValues={draft.legendValues}
          showCategoryCount={draft.showCategoryCount}
          colors={previewColors(draft.colors, categories.slices.map((slice) => slice.label))}
          className="w-full max-w-xs md:max-w-md"
        />
      }
    />
  );
}

const PieChartSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  settings: PieChartSettings;
  onApply: (settings: PieChartSettings) => void;
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

export default PieChartSettingsDialog;
