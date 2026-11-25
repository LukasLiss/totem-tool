/**
 * Building blocks of the chart settings popups (pie and bar chart): the
 * popup frame with Data / Style tabs and a sketch beside them, the Data tab
 * (query and columns), the color settings, and small setting rows. Each
 * chart keeps its draft settings itself and fills in its own Style tab and
 * sketch; hooks are in chartSettingsUtils.ts.
 */

import React from "react";
import { X } from "lucide-react";
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
import type { ExpectedResult } from "@/react_component/SqlQueryEditor";
import type { LinkedQuery } from "@/react_component/sql/linkedQuery";
import { cn } from "@/lib/utils";
import { ColumnInput, QuerySection, SegmentedControl } from "./shared";
import type { ColumnDiscovery } from "./sqlWidgetUtils";
import { CHART_SKETCH_HINT } from "./constants";
import {
  COLOR_SCHEME_OPTIONS,
  DEFAULT_COLOR_SCHEME,
  DEFAULT_SHADES_BASE,
  DEFAULT_SINGLE_COLOR,
  DEFAULT_SINGLE_PICKER,
  categoryFills,
  previewColors,
  supportsStableColors,
  type ChartColors,
} from "./chartColors";
import type { CategoryList } from "./chartSettingsUtils";

export type ChartSettingsTab = "data" | "style";

/* ------------------------------------------------------------------ */
/* Frame                                                               */
/* ------------------------------------------------------------------ */

/**
 * The modal itself, as wide as the SQL editor popup. Its content is
 * unmounted while closed, so a settings body inside starts from the applied
 * settings on every open.
 */
export function ChartSettingsDialog({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* As wide as the SQL editor popup (SqlQueryEditorDialog), and as tall up to
          three quarters of that width, so it keeps a landscape shape on tall screens. */}
      <DialogContent className="flex h-[min(88vh,calc(min(1200px,94vw)*0.75))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,94vw)]">
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Header, title field, Data / Style tabs on the left, the sketch on the
 * right (above on narrow screens), Cancel / Apply below. Widgets without a
 * title, data or style settings leave out `onTitleChange`, `dataTab` or
 * `styleTab`; with only one of the two tabs, the tab bar is left out and its
 * settings show directly.
 */
export function ChartSettingsLayout({
  heading,
  idPrefix,
  title,
  onTitleChange,
  titlePlaceholder = "Chart title",
  tab,
  onTabChange,
  dataTab,
  styleTab,
  sketch,
  sketchHint = CHART_SKETCH_HINT,
  onApply,
  onCancel,
}: {
  heading: string;
  /** Prefix for element ids, unique per widget. */
  idPrefix: string;
  title?: string;
  onTitleChange?: (title: string) => void;
  /** Shown in the empty Title field; what the widget shows without a title. */
  titlePlaceholder?: string;
  tab?: ChartSettingsTab;
  onTabChange?: (tab: ChartSettingsTab) => void;
  dataTab?: React.ReactNode;
  /** Leave out when a widget has only data settings: the Data tab then shows without tabs. */
  styleTab?: React.ReactNode;
  sketch: React.ReactNode;
  /** Caption below the sketch; defaults to the chart explanation. */
  sketchHint?: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <DialogHeader className="border-b px-6 pt-6 pb-4">
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>Choose the data and how it is displayed.</DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_420px] md:grid-rows-1">
        {/* A column of fixed-size parts; in the Data tab only the query box may shrink. */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
          {onTitleChange && (
            <div className="grid shrink-0 gap-1.5">
              <Label htmlFor={`${idPrefix}-title`}>Title</Label>
              <Input
                id={`${idPrefix}-title`}
                value={title ?? ""}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder={titlePlaceholder}
              />
            </div>
          )}

          {dataTab && !styleTab ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4">{dataTab}</div>
          ) : dataTab ? (
            <>
              <div role="tablist" className="flex shrink-0 gap-5 border-b">
                {([["data", "Data"], ["style", "Style"]] as const).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => onTabChange?.(value)}
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
                  {dataTab}
                </div>
              )}
              {tab === "style" && (
                <div className="shrink-0 space-y-2" role="tabpanel">
                  {styleTab}
                </div>
              )}
            </>
          ) : (
            <div className="shrink-0 space-y-2">{styleTab}</div>
          )}
        </div>

        {/* The sketch stays visible whichever tab is open; above the settings on narrow screens. */}
        <div className="order-first flex flex-col items-center justify-center gap-3 border-b bg-muted/30 p-4 md:order-none md:border-b-0 md:border-l md:p-6">
          {sketch}
          <p className="max-w-xs text-center text-xs text-muted-foreground">{sketchHint}</p>
        </div>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onApply}>Apply</Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Data tab                                                            */
/* ------------------------------------------------------------------ */

// Select items can't have an empty value, so "automatic" (an empty column) gets this one.
const AUTO_COLUMN = "__auto__";

/**
 * Column picker: a dropdown once the query's columns are known, a text field
 * before. With `autoLabel` the column is optional: the dropdown starts with
 * that choice (e.g. "Automatic (first numeric column)"), which stands for
 * an empty column name.
 */
function ColumnSelect({ id, label, value, onChange, columns, loading, autoLabel }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  columns: string[];
  loading: boolean;
  autoLabel?: string;
}) {
  if (columns.length === 0) {
    return (
      <ColumnInput
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        columns={[]}
        placeholder={autoLabel ?? "column name"}
        hint={loading ? "Detecting columns…" : undefined}
      />
    );
  }
  // Keep a column that isn't in the current result selectable, so it isn't silently dropped.
  const options = !value || columns.includes(value) ? columns : [value, ...columns];
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || (autoLabel ? AUTO_COLUMN : undefined)}
        onValueChange={(v) => onChange(v === AUTO_COLUMN ? "" : v)}
      >
        <SelectTrigger id={id} className="w-full font-mono text-xs">
          <SelectValue placeholder="Choose a column" />
        </SelectTrigger>
        <SelectContent>
          {autoLabel && (
            <SelectItem value={AUTO_COLUMN} className="text-xs">
              {autoLabel}
            </SelectItem>
          )}
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

export interface ColumnField {
  /** Part of the element id, e.g. "label". */
  key: string;
  label: string;
  value: string;
  onChange: (column: string) => void;
  /** Makes the column optional, with this as the "automatic" choice. */
  autoLabel?: string;
}

/** The growing query field and the widget's column pickers. */
export function ChartDataTab({
  widgetId,
  idPrefix,
  query,
  onQueryChange,
  linked,
  onLinkChange,
  columnFields,
  fileId,
  projectId,
  expectedResult,
  editorTitle,
  discovery,
  rowLimit,
  onRowLimitChange,
}: {
  widgetId: number;
  idPrefix: string;
  query: string;
  onQueryChange: (query: string) => void;
  linked: LinkedQuery | null;
  onLinkChange: (link: LinkedQuery | null) => void;
  columnFields: ColumnField[];
  fileId?: number;
  projectId?: number;
  /** What the widget reads from the result; omit when any result is fine. */
  expectedResult?: ExpectedResult | null;
  editorTitle: string;
  discovery: ColumnDiscovery;
  /** rows per page for the SQL editor's page selector (see SqlQueryField) */
  rowLimit?: number;
  onRowLimitChange?: (rowLimit: number) => void;
}) {
  return (
    <>
      <QuerySection
        rowLimit={rowLimit}
        onRowLimitChange={onRowLimitChange}
        className="flex min-h-0 flex-col"
        growQuery
        widgetId={widgetId}
        query={query}
        onQueryChange={onQueryChange}
        linkedQuery={linked}
        onLinkChange={onLinkChange}
        fileId={fileId}
        projectId={projectId}
        expectedResult={expectedResult}
        editorTitle={editorTitle}
        discovery={discovery}
      />
      {columnFields.length > 0 && (
      <div className="grid shrink-0 grid-cols-2 gap-4">
        {columnFields.map((field) => (
          <ColumnSelect
            key={field.key}
            id={`${idPrefix}-${field.key}`}
            label={field.label}
            value={field.value}
            onChange={field.onChange}
            columns={discovery.columns}
            loading={discovery.loading}
            autoLabel={field.autoLabel}
          />
        ))}
      </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Style tab pieces                                                    */
/* ------------------------------------------------------------------ */

/** A setting with its label on the left and the control on the right. */
export function SettingRow({ label, htmlFor, disabled = false, children }: {
  label: string;
  htmlFor?: string;
  /** Greys out the label, for a control that doesn't apply right now. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <Label htmlFor={htmlFor} className={cn("shrink-0", disabled && "opacity-50")}>
        {label}
      </Label>
      {children}
    </div>
  );
}

/** "Max categories" with a number field; empty means `placeholder` (all, by default). */
export function MaxCategoriesRow({
  id,
  value,
  onChange,
  hint,
  label = "Max categories",
  placeholder = "All",
  disabled = false,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** What happens to the remaining categories, e.g. "rest grouped as “Other”". */
  hint: string;
  label?: string;
  /** Shown when empty: what an empty field means, e.g. "All" or a default number. */
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <SettingRow label={label} htmlFor={id} disabled={disabled}>
      <span className={cn("flex items-center gap-2", disabled && "opacity-50")}>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <Input
          id={id}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          disabled={disabled}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) && n > 0 ? n : null);
          }}
          className="h-8 w-20"
        />
      </span>
    </SettingRow>
  );
}

/** A color swatch that opens the browser's color picker when clicked. */
function ColorSwatchInput({ color, value, onChange, label }: {
  /** What the swatch shows (any CSS color). */
  color: string;
  /** Start value of the picker, #rrggbb. */
  value: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  return (
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
}

const COLOR_MODE_OPTIONS = [
  { value: "single", label: "Single color" },
  { value: "category", label: "Per category" },
] as const;

/**
 * Colors: the color scheme cards (with "Same color per category" and the
 * Shades base color), or for bar charts also a single color for all bars,
 * and below the list of categories to give single ones a fixed color.
 */
export function ColorSettings({
  idPrefix,
  colors,
  onChange,
  categories,
  singleColorLabel,
  singleOnly = false,
}: {
  idPrefix: string;
  colors: ChartColors;
  onChange: (colors: ChartColors) => void;
  categories: CategoryList;
  /**
   * Offer "Single color" next to "Per category" (bar charts), with this label
   * for its color, e.g. "Bar color". Single color is then the default.
   */
  singleColorLabel?: string;
  /**
   * Only the single color, without "Color by" and category colors (e.g. a
   * scatter plot without a series column has no categories to color).
   */
  singleOnly?: boolean;
}) {
  const mode = singleOnly ? "single" : singleColorLabel ? colors.mode ?? "single" : "category";
  const scheme = colors.scheme ?? DEFAULT_COLOR_SCHEME;
  const overrides = colors.overrides ?? {};
  const fills = categoryFills(categories.slices, { ...colors, mode });
  const update = (patch: Partial<ChartColors>) => onChange({ ...colors, ...patch });
  const setOverride = (label: string, color: string | null) => {
    const next = { ...overrides };
    if (color) next[label] = color;
    else delete next[label];
    update({ overrides: next });
  };

  return (
    <>
      <div className="space-y-2 border-t pt-4">
        <Label>Colors</Label>
        {singleColorLabel && !singleOnly && (
          <SettingRow label="Color by">
            <SegmentedControl
              ariaLabel="Color by"
              value={mode}
              options={COLOR_MODE_OPTIONS}
              onChange={(v) => update({ mode: v })}
            />
          </SettingRow>
        )}
        {mode === "single" ? (
          <SettingRow label={singleColorLabel ?? "Color"}>
            <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              {colors.single ?? "black"}
              <ColorSwatchInput
                label={singleColorLabel ?? "Color"}
                color={colors.single ?? DEFAULT_SINGLE_COLOR}
                value={colors.single ?? DEFAULT_SINGLE_PICKER}
                onChange={(hex) => update({ single: hex })}
              />
            </span>
          </SettingRow>
        ) : (
          <>
            <div role="radiogroup" aria-label="Color scheme" className="grid grid-cols-3 gap-2">
              {COLOR_SCHEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={scheme === option.value}
                  onClick={() => update({ scheme: option.value })}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-md border p-2 text-left text-xs transition-colors",
                    scheme === option.value ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/50"
                  )}
                >
                  <span className="flex h-3 overflow-hidden rounded-sm">
                    {previewColors({ scheme: option.value, base: colors.base }).map((color, i) => (
                      <span key={i} className="flex-1" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
            {supportsStableColors(scheme) && (
              <div className="space-y-0.5">
                <SettingRow label="Same color per category" htmlFor={`${idPrefix}-stable-colors`}>
                  <Switch
                    id={`${idPrefix}-stable-colors`}
                    checked={Boolean(colors.stable)}
                    onCheckedChange={(v) => update({ stable: v })}
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
                  {colors.base ?? DEFAULT_SHADES_BASE}
                  <ColorSwatchInput
                    label="Base color"
                    color={colors.base ?? DEFAULT_SHADES_BASE}
                    value={colors.base ?? DEFAULT_SHADES_BASE}
                    onChange={(hex) => update({ base: hex })}
                  />
                </span>
              </SettingRow>
            )}
          </>
        )}
      </div>

      {!singleOnly && (
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <Label>Category colors</Label>
          {Object.keys(overrides).length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => update({ overrides: {} })}
            >
              Reset all
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            Click the colored square next to a category to choose its own color.
          </span>{" "}
          It then keeps that color regardless of the colors above — for example, make one
          category red in a grey chart to highlight it.
        </p>
        {categories.needsColumns ? (
          <p className="text-xs text-muted-foreground">Set up the query and columns in the Data tab first.</p>
        ) : categories.loading ? (
          <p className="text-xs text-muted-foreground">Loading categories…</p>
        ) : categories.error ? (
          <p className="text-xs text-destructive">{categories.error}</p>
        ) : categories.slices.length === 0 ? (
          <p className="text-xs text-muted-foreground">The query returned no categories.</p>
        ) : (
          <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
            {categories.slices.map(({ label }, i) => (
              <div key={`${label}-${i}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <ColorSwatchInput
                  label={`Color for ${label}`}
                  color={fills[i]}
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
                    title="Use the regular color again"
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
      )}
    </>
  );
}
