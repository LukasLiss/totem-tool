/**
 * PieChartSettingsDialog — the pie chart widget's settings in a modal popup:
 * a Data tab (query and columns) and a Style tab (chart type, legend, values,
 * category count) on the left, and a layout sketch on the right that follows
 * the settings. Changes are kept as a draft and only reach the widget on
 * Apply; Cancel, the close button or a click outside discard them.
 */

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { ColumnInput, QuerySection, SegmentedControl } from "@/components/sql-widgets/shared";
import { useColumnDiscovery } from "@/components/sql-widgets/sqlWidgetUtils";
import { PIE_CHART_EXPECTED_RESULT } from "@/components/sql-widgets/constants";
import {
  limitCategories,
  type LegendPosition,
  type LegendValues,
} from "@/components/sql-widgets/chartLegendUtils";
import {
  COLOR_SCHEME_OPTIONS,
  DEFAULT_COLOR_SCHEME,
  DEFAULT_SHADES_BASE,
  categoryFills,
  previewColors,
  supportsStableColors,
  type ChartColors,
} from "@/components/sql-widgets/chartColors";
import { useSqlQueryData } from "@/react_component/sql/useSqlQueryData";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
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

type Tab = "data" | "style";

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

/** A setting with its label on the left and the control on the right. */
const SettingRow = ({ label, htmlFor, disabled = false, children }: {
  label: string;
  htmlFor?: string;
  /** Greys out the label, for a control that doesn't apply right now. */
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <div className="flex min-h-9 items-center justify-between gap-4">
    <Label htmlFor={htmlFor} className={cn("shrink-0", disabled && "opacity-50")}>
      {label}
    </Label>
    {children}
  </div>
);

/** A color swatch that opens the browser's color picker when clicked. */
const ColorSwatchInput = ({ color, value, onChange, label }: {
  /** What the swatch shows (any CSS color). */
  color: string;
  /** Start value of the picker, #rrggbb. */
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) => (
  <span className="relative inline-flex size-5 shrink-0 overflow-hidden rounded border shadow-xs">
    <span className="size-full" style={{ backgroundColor: color }} />
    <input
      type="color"
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="absolute inset-0 size-full cursor-pointer opacity-0"
    />
  </span>
);

/** Column picker: a dropdown once the query's columns are known, a text field before. */
function ColumnSelect({ id, label, value, onChange, columns, loading }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  columns: string[];
  loading: boolean;
}) {
  if (columns.length === 0) {
    return (
      <ColumnInput
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        columns={[]}
        placeholder="column name"
        hint={loading ? "Detecting columns…" : undefined}
      />
    );
  }
  // Keep a column that isn't in the current result selectable, so it isn't silently dropped.
  const options = !value || columns.includes(value) ? columns : [value, ...columns];
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full font-mono text-xs">
          <SelectValue placeholder="Choose a column" />
        </SelectTrigger>
        <SelectContent>
          {options.map((column) => (
            <SelectItem key={column} value={column} className="font-mono text-xs">
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The dialog body; mounted on every open, so the draft starts from the applied settings. */
function SettingsBody({ widgetId, initial, onApply, onCancel, fileId, projectId }: {
  widgetId: number;
  initial: PieChartSettings;
  onApply: (settings: PieChartSettings) => void;
  onCancel: () => void;
  fileId?: number;
  projectId?: number;
}) {
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<Tab>(initial.labelColumn && initial.valueColumn ? "style" : "data");
  const set = <K extends keyof PieChartSettings>(key: K, value: PieChartSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const discovery = useColumnDiscovery(fileId, draft.query, draft.linked?.id);
  // Look up the columns once on open, so the column dropdowns are ready.
  const { discover } = discovery;
  const autoDiscovered = useRef(false);
  useEffect(() => {
    if (autoDiscovered.current) return;
    autoDiscovered.current = true;
    if (fileId && (initial.query.trim() || initial.linked)) void discover();
  }, [discover, fileId, initial.query, initial.linked]);

  const legend = draft.showLegend ? draft.legendPosition : "none";

  // The real categories, for per-category colors; only loaded on the Style tab.
  const categoryData = useSqlQueryData({
    fileId,
    query: draft.query,
    queryAssetId: draft.linked?.id,
    enabled: tab === "style" && Boolean(draft.labelColumn && draft.valueColumn),
    limit: 500,
  });
  // The slices the chart will show: grouped into "Other" like the real chart.
  const categorySlices = React.useMemo(
    () =>
      draft.labelColumn && draft.valueColumn
        ? limitCategories(
            categoryData.rows.map((row) => ({
              label: String(row[draft.labelColumn]),
              value: parseFloat(String(row[draft.valueColumn])) || 0,
            })),
            draft.maxCategories
          )
        : [],
    [categoryData.rows, draft.labelColumn, draft.valueColumn, draft.maxCategories]
  );
  const categories = categorySlices.map((slice) => slice.label);
  const categoryColors = categoryFills(categorySlices, draft.colors);
  const scheme = draft.colors.scheme ?? DEFAULT_COLOR_SCHEME;
  const overrides = draft.colors.overrides ?? {};
  const setColors = (colors: Partial<ChartColors>) => set("colors", { ...draft.colors, ...colors });
  const setOverride = (label: string, color: string | null) => {
    const next = { ...overrides };
    if (color) next[label] = color;
    else delete next[label];
    setColors({ overrides: next });
  };

  return (
    <>
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>Pie chart settings</DialogTitle>
        <DialogDescription>Choose the data and how the chart is displayed.</DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_420px] md:grid-rows-1">
        {/* A column of fixed-size parts; in the Data tab only the query box may shrink. */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
          <div className="grid shrink-0 gap-1.5">
            <Label htmlFor={`pie-title-${widgetId}`}>Title</Label>
            <Input
              id={`pie-title-${widgetId}`}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Chart title"
            />
          </div>

          <div role="tablist" className="flex shrink-0 gap-5 border-b">
            {([["data", "Data"], ["style", "Style"]] as const).map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-px border-b-2 px-0.5 pb-2 text-sm font-medium transition-colors",
                  tab === value
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {text}
              </button>
            ))}
          </div>

          {tab === "data" && (
            <div className="flex min-h-0 flex-1 flex-col gap-4" role="tabpanel">
              <QuerySection
                className="flex min-h-0 flex-col"
                growQuery
                widgetId={widgetId}
                query={draft.query}
                onQueryChange={(q) => set("query", q)}
                linkedQuery={draft.linked}
                onLinkChange={(l) => set("linked", l)}
                fileId={fileId}
                projectId={projectId}
                expectedResult={PIE_CHART_EXPECTED_RESULT}
                editorTitle="Pie chart query"
                discovery={discovery}
              />
              <div className="grid shrink-0 grid-cols-2 gap-4">
                <ColumnSelect
                  id={`pie-label-${widgetId}`}
                  label="Label column"
                  value={draft.labelColumn}
                  onChange={(v) => set("labelColumn", v)}
                  columns={discovery.columns}
                  loading={discovery.loading}
                />
                <ColumnSelect
                  id={`pie-value-${widgetId}`}
                  label="Value column"
                  value={draft.valueColumn}
                  onChange={(v) => set("valueColumn", v)}
                  columns={discovery.columns}
                  loading={discovery.loading}
                />
              </div>
            </div>
          )}

          {tab === "style" && (
            <div className="shrink-0 space-y-2" role="tabpanel">
              <SettingRow label="Type">
                <SegmentedControl
                  ariaLabel="Chart type"
                  value={draft.chartType}
                  options={CHART_TYPE_OPTIONS}
                  onChange={(v) => set("chartType", v)}
                />
              </SettingRow>
              {/* Only a donut has a center; for a pie the field stays visible but disabled. */}
              <SettingRow
                label="Center text"
                htmlFor={`pie-center-${widgetId}`}
                disabled={draft.chartType !== "donut"}
              >
                <Input
                  id={`pie-center-${widgetId}`}
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
              <SettingRow label="Number of categories" htmlFor={`pie-category-count-${widgetId}`}>
                <Switch
                  id={`pie-category-count-${widgetId}`}
                  checked={draft.showCategoryCount}
                  onCheckedChange={(v) => set("showCategoryCount", v)}
                />
              </SettingRow>
              <SettingRow label="Max categories" htmlFor={`pie-max-categories-${widgetId}`}>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">rest grouped as “Other”</span>
                  <Input
                    id={`pie-max-categories-${widgetId}`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="All"
                    value={draft.maxCategories ?? ""}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      set("maxCategories", Number.isFinite(n) && n > 0 ? n : null);
                    }}
                    className="h-8 w-20"
                  />
                </span>
              </SettingRow>

              <div className="space-y-2 border-t pt-4">
                <Label>Colors</Label>
                <div role="radiogroup" aria-label="Color scheme" className="grid grid-cols-3 gap-2">
                  {COLOR_SCHEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={scheme === option.value}
                      onClick={() => setColors({ scheme: option.value })}
                      className={cn(
                        "flex flex-col gap-1.5 rounded-md border p-2 text-left text-xs transition-colors",
                        scheme === option.value
                          ? "border-foreground ring-1 ring-foreground"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <span className="flex h-3 overflow-hidden rounded-sm">
                        {previewColors({ scheme: option.value, base: draft.colors.base }).map((color, i) => (
                          <span key={i} className="flex-1" style={{ backgroundColor: color }} />
                        ))}
                      </span>
                      {option.label}
                    </button>
                  ))}
                </div>
                {supportsStableColors(scheme) && (
                  <div className="space-y-0.5">
                    <SettingRow label="Same color per category" htmlFor={`pie-stable-colors-${widgetId}`}>
                      <Switch
                        id={`pie-stable-colors-${widgetId}`}
                        checked={Boolean(draft.colors.stable)}
                        onCheckedChange={(v) => setColors({ stable: v })}
                      />
                    </SettingRow>
                    <p className="text-xs text-muted-foreground">
                      The color follows the category name instead of its position, so a category
                      keeps its color across logs and when the data changes.
                    </p>
                  </div>
                )}
                {scheme === "shades" && (
                  <SettingRow label="Base color">
                    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      {draft.colors.base ?? DEFAULT_SHADES_BASE}
                      <ColorSwatchInput
                        label="Base color"
                        color={draft.colors.base ?? DEFAULT_SHADES_BASE}
                        value={draft.colors.base ?? DEFAULT_SHADES_BASE}
                        onChange={(hex) => setColors({ base: hex })}
                      />
                    </span>
                  </SettingRow>
                )}
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <Label>Category colors</Label>
                  {Object.keys(overrides).length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setColors({ overrides: {} })}
                    >
                      Reset all
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Click the colored square next to a category to choose its own color.
                  </span>{" "}
                  It then keeps that color regardless of the scheme above — for example, make one
                  category red in a grey chart to highlight it.
                </p>
                {!(draft.labelColumn && draft.valueColumn) ? (
                  <p className="text-xs text-muted-foreground">Set up the query and columns in the Data tab first.</p>
                ) : categoryData.loading ? (
                  <p className="text-xs text-muted-foreground">Loading categories…</p>
                ) : categoryData.error ? (
                  <p className="text-xs text-destructive">{categoryData.error}</p>
                ) : categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">The query returned no categories.</p>
                ) : (
                  <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
                    {categories.map((label, i) => (
                      <div key={`${label}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                        <ColorSwatchInput
                          label={`Color for ${label}`}
                          color={categoryColors[i]}
                          value={overrides[label] ?? "#808080"}
                          onChange={(hex) => setOverride(label, hex)}
                        />
                        <span className="min-w-0 flex-1 truncate" title={label}>
                          {label}
                        </span>
                        {overrides[label] && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Use the scheme color again"
                            aria-label={`Reset color for ${label}`}
                            onClick={() => setOverride(label, null)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* The sketch stays visible whichever tab is open; above the settings on narrow screens. */}
        <div className="order-first flex items-center border-b bg-muted/30 p-4 md:order-none md:border-b-0 md:border-l md:p-6">
          <PieChartSketch
            title={draft.title}
            chartType={draft.chartType}
            showCenterText={Boolean(draft.ringText)}
            showLegend={draft.showLegend}
            legendPosition={draft.legendPosition}
            legendValues={draft.legendValues}
            showCategoryCount={draft.showCategoryCount}
            colors={previewColors(draft.colors, categories)}
            className="w-full max-w-xs md:max-w-md"
          />
        </div>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onApply(draft)}>Apply</Button>
      </DialogFooter>
    </>
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
  <Dialog open={open} onOpenChange={onOpenChange}>
    {/* Same size as the SQL editor popup (SqlQueryEditorDialog). */}
    <DialogContent className="flex h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,94vw)]">
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
    </DialogContent>
  </Dialog>
);

export default PieChartSettingsDialog;
