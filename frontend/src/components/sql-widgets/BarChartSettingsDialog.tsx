/**
 * BarChartSettingsDialog — the bar chart widget's settings in a modal popup,
 * built like the pie chart's: a Data tab (query and columns) and a Style tab
 * (orientation, values, max categories, colors) beside a layout sketch.
 * Changes are kept as a draft and only reach the widget on Apply.
 */

import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { SegmentedControl } from "./shared";
import { useColumnDiscovery } from "./sqlWidgetUtils";
import { BAR_CHART_EXPECTED_RESULT } from "./constants";
import { previewColors, type ChartColors } from "./chartColors";
import {
  ChartDataTab,
  ChartSettingsDialog,
  ChartSettingsLayout,
  ColorSettings,
  MaxCategoriesRow,
  SettingRow,
  type ChartSettingsTab,
} from "./chartSettings";
import { useCategoryList, useDiscoverOnOpen } from "./chartSettingsUtils";
import BarChartSketch from "./BarChartSketch";

export interface BarChartSettings {
  title: string;
  query: string;
  linked: LinkedQuery | null;
  labelColumn: string;
  valueColumn: string;
  horizontal: boolean;
  showValues: boolean;
  colors: ChartColors;
  /** Only the largest N bars are shown, the rest left out; null = all. */
  maxCategories: number | null;
}

const ORIENTATION_OPTIONS = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
] as const;

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel, fileId, projectId }: {
  widgetId: number;
  initial: BarChartSettings;
  onApply: (settings: BarChartSettings) => void;
  onCancel: () => void;
  fileId?: number;
  projectId?: number;
}) {
  const idPrefix = `bar-${widgetId}`;
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<ChartSettingsTab>(
    initial.labelColumn && initial.valueColumn ? "style" : "data"
  );
  const set = <K extends keyof BarChartSettings>(key: K, value: BarChartSettings[K]) =>
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
    groupRest: false,
  });

  // Bar charts default to a single color.
  const colors: ChartColors = { mode: "single", ...draft.colors };

  return (
    <ChartSettingsLayout
      heading="Bar chart settings"
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
          // Both optional: the bar chart falls back to these columns on its own.
          columnFields={[
            {
              key: "label",
              label: "Label column",
              value: draft.labelColumn,
              onChange: (v) => set("labelColumn", v),
              autoLabel: "Automatic (first other column)",
            },
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
          expectedResult={BAR_CHART_EXPECTED_RESULT}
          editorTitle="Bar chart query"
          discovery={discovery}
        />
      }
      styleTab={
        <>
          <SettingRow label="Orientation">
            <SegmentedControl
              ariaLabel="Orientation"
              value={draft.horizontal ? "horizontal" : "vertical"}
              options={ORIENTATION_OPTIONS}
              onChange={(v) => set("horizontal", v === "horizontal")}
            />
          </SettingRow>
          <SettingRow label="Show values on bars" htmlFor={`${idPrefix}-values`}>
            <Switch
              id={`${idPrefix}-values`}
              checked={draft.showValues}
              onCheckedChange={(v) => set("showValues", v)}
            />
          </SettingRow>
          <MaxCategoriesRow
            id={`${idPrefix}-max-categories`}
            value={draft.maxCategories}
            onChange={(v) => set("maxCategories", v)}
            hint="smaller ones left out"
          />
          <ColorSettings
            idPrefix={idPrefix}
            colors={colors}
            onChange={(next) => set("colors", next)}
            categories={categories}
            singleColorLabel="Bar color"
          />
        </>
      }
      sketch={
        <BarChartSketch
          title={draft.title}
          horizontal={draft.horizontal}
          showValues={draft.showValues}
          colors={previewColors(colors, categories.slices.map((slice) => slice.label))}
          className="w-full max-w-xs md:max-w-md"
        />
      }
    />
  );
}

const BarChartSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgetId: number;
  settings: BarChartSettings;
  onApply: (settings: BarChartSettings) => void;
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

export default BarChartSettingsDialog;
