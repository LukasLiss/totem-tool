import { useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, RefreshCw, Search } from "lucide-react";

import type { ProjectAsset } from "@/api/assetsApi";
import type { EventColumnInfo } from "@/api/occnConformanceApi";
import type { OCAlignmentExecutionSummary, OCAlignmentExecutionsResponse } from "@/api/ocAlignmentApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectPopover } from "@/react_component/variants/MultiSelectPopover";
import { ProcessAreaPicker } from "@/react_component/process-area/ProcessAreaPicker";
import type { ProcessAreasSnapshot } from "@/store/processAreaStore";

import type { OCAlignmentSettings } from "./settings";

function Field({ label, htmlFor, hint, children }: {
  label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function formatTime(unix: number | null) {
  if (unix === null || unix === undefined) return "–";
  const date = new Date(unix * 1000);
  return Number.isNaN(date.getTime())
    ? "–"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

export interface OCAlignmentSettingsPanelProps {
  settings: OCAlignmentSettings;
  onChange: (next: OCAlignmentSettings) => void;
  assets: ProjectAsset[];
  assetsLoading: boolean;
  assetsError: string | null;
  onOpenModelAssets?: () => void;
  objectTypes: string[];
  activities: string[];
  columns: EventColumnInfo[];
  optionsLoading: boolean;
  processAreas: ProcessAreasSnapshot | null;
  areasLoading: boolean;
  areasError: string | null;
  onComputeAreas: () => void;
  executions: OCAlignmentExecutionsResponse | null;
  executionsLoading: boolean;
  executionsError: string | null;
  executionsBlocker: string | null;
  onRetryExecutions: () => void;
  disabled?: boolean;
  /** Narrow layout for dashboard tiles. */
  compact?: boolean;
}

/**
 * Model, process-execution source and the execution to align.
 *
 * The execution comes either from the ids the Variants Explorer stored in an
 * events column, or from a connected-component extraction over business
 * object types and activities -- prefilled from a process area or chosen by
 * hand.
 */
export function OCAlignmentSettingsPanel(props: OCAlignmentSettingsPanelProps) {
  const {
    settings, onChange, assets, assetsLoading, assetsError, onOpenModelAssets,
    objectTypes, activities, columns, optionsLoading, processAreas, areasLoading,
    areasError, onComputeAreas, disabled = false, compact = false,
  } = props;
  const update = (patch: Partial<OCAlignmentSettings>) => onChange({ ...settings, ...patch });
  // A different source invalidates the selected execution.
  const updateSource = (patch: Partial<OCAlignmentSettings>) =>
    onChange({ ...settings, ...patch, executionId: "" });
  const grid = compact ? "grid gap-3" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="space-y-4" data-testid="oc-alignment-settings">
      <div className={grid}>
        <Field
          label="OCPN model"
          htmlFor="oc-alignment-model"
          hint={
            assetsError ? (
              <span className="text-destructive">{assetsError}</span>
            ) : !assetsLoading && assets.length === 0 ? (
              <>
                No object-centric Petri net in this project yet.{" "}
                {onOpenModelAssets ? (
                  <button type="button" className="underline" onClick={onOpenModelAssets}>
                    Open model assets
                  </button>
                ) : (
                  "Save one from Analysis → OC Petri Net or upload it as a model asset."
                )}
              </>
            ) : (
              "The de-jure model the execution is aligned with."
            )
          }
        >
          <Select
            value={settings.assetId ? String(settings.assetId) : ""}
            onValueChange={(value) => update({ assetId: Number(value) || null })}
            disabled={disabled || assetsLoading || assets.length === 0}
          >
            <SelectTrigger id="oc-alignment-model" aria-label="OCPN model" className="w-full">
              <SelectValue placeholder={assetsLoading ? "Loading models…" : "Select an OCPN model"} />
            </SelectTrigger>
            <SelectContent>
              {assets.map((asset) => (
                <SelectItem key={asset.id} value={String(asset.id)}>
                  {asset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Process execution source"
          htmlFor="oc-alignment-source"
          hint={
            settings.source === "stored"
              ? "Executions stored in the event log by the Variants Explorer."
              : "Connected components of the business objects, linked by the business activities."
          }
        >
          <Select
            value={settings.source}
            onValueChange={(value) => updateSource({ source: value as OCAlignmentSettings["source"] })}
            disabled={disabled}
          >
            <SelectTrigger id="oc-alignment-source" aria-label="Process execution source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="area">Process area / manual selection</SelectItem>
              <SelectItem value="stored">Stored process executions</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {settings.source === "stored" ? (
          <Field
            label="Process execution column"
            htmlFor="oc-alignment-column"
            hint={
              columns.length === 0 && !optionsLoading
                ? "No stored executions in this log. Use Variants → Settings → Store in event log first."
                : "Events with the same id in this column form one execution."
            }
          >
            <Select
              value={settings.executionColumn}
              onValueChange={(value) => updateSource({ executionColumn: value })}
              disabled={disabled || optionsLoading || columns.length === 0}
            >
              <SelectTrigger id="oc-alignment-column" aria-label="Process execution column" className="w-full">
                <SelectValue placeholder={optionsLoading ? "Loading columns…" : "Select column"} />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column.name} value={column.name}>
                    {column.name} ({column.distinct_count.toLocaleString()} ids)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field
            label="Process area"
            hint={
              processAreas
                ? "Fills in the area's object types and activities; adjust them below."
                : areasError ?? "No process areas computed for this log yet."
            }
          >
            <ProcessAreaPicker
              current={processAreas}
              selectedObjectTypes={settings.businessObjectTypes}
              selectedActivities={settings.businessActivities}
              onPick={(area) =>
                updateSource({
                  businessObjectTypes: [...area.objectTypes].sort((a, b) => a.localeCompare(b)),
                  businessActivities: [...area.activities].sort((a, b) => a.localeCompare(b)),
                })
              }
              onComputeCurrent={onComputeAreas}
              computeLoading={areasLoading}
              computeError={areasError}
              disabled={disabled}
            />
          </Field>
        )}

        {settings.source === "area" ? (
          <>
            <Field
              label="Business object types"
              hint="Objects of these types form the executions; other types are left out."
            >
              <MultiSelectPopover
                label="Business object types"
                options={objectTypes}
                selected={settings.businessObjectTypes}
                onChange={(businessObjectTypes) => updateSource({ businessObjectTypes })}
                placeholder="Select object types"
                allLabel="All object types"
                disabled={disabled}
                loading={optionsLoading}
                className="w-full"
              />
            </Field>
            <Field
              label="Business activities"
              hint="Only these activities link objects and are aligned. Empty = every activity."
            >
              <MultiSelectPopover
                label="Business activities"
                options={activities}
                selected={settings.businessActivities}
                onChange={(businessActivities) => updateSource({ businessActivities })}
                placeholder="All activities"
                allLabel="All activities"
                disabled={disabled}
                loading={optionsLoading}
                className="w-full"
              />
            </Field>
          </>
        ) : null}
      </div>

      <ExecutionPicker {...props} />
    </div>
  );
}

type SortKey = "start" | "events" | "objects" | "id";

function ExecutionPicker({
  settings,
  onChange,
  executions,
  executionsLoading,
  executionsError,
  executionsBlocker,
  onRetryExecutions,
  disabled = false,
  compact = false,
}: OCAlignmentSettingsPanelProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("start");
  const rows = useMemo(() => {
    const list = executions?.executions ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = needle ? list.filter((e) => e.id.toLowerCase().includes(needle)) : list;
    const sorted = [...filtered];
    if (sort === "events") sorted.sort((a, b) => b.event_count - a.event_count || a.id.localeCompare(b.id));
    else if (sort === "objects") sorted.sort((a, b) => b.object_count - a.object_count || a.id.localeCompare(b.id));
    else if (sort === "id") sorted.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return sorted;
  }, [executions, query, sort]);
  const selected = executions?.executions.find((e) => e.id === settings.executionId) ?? null;
  const selectedMissing = Boolean(settings.executionId) && executions !== null && !selected;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Label>Process execution</Label>
          <p className="text-xs text-muted-foreground">
            {executions
              ? `${executions.total.toLocaleString()} executions${executions.truncated ? ` (showing the first ${executions.executions.length.toLocaleString()})` : ""}. Alignments grow exponentially with the size of an execution — start with small ones.`
              : "Pick the execution to align."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search executions"
              placeholder="Search id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`h-9 pl-8 ${compact ? "w-32" : "w-44"}`}
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger aria-label="Sort executions" className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="start">Sort: start time</SelectItem>
              <SelectItem value="events">Sort: most events</SelectItem>
              <SelectItem value="objects">Sort: most objects</SelectItem>
              <SelectItem value="id">Sort: id</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-h-64 overflow-auto rounded-md border" role="listbox" aria-label="Process executions">
        {executionsBlocker ? (
          <p className="p-3 text-sm text-muted-foreground">{executionsBlocker}</p>
        ) : executionsLoading ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Extracting process executions…
          </p>
        ) : executionsError ? (
          <div className="flex items-center justify-between gap-2 p-3 text-sm text-destructive" role="alert">
            <span>{executionsError}</span>
            <Button size="sm" variant="outline" onClick={onRetryExecutions}>
              <RefreshCw /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {executions?.total ? "No execution matches the search." : "The source yields no process executions."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Execution</th>
                <th className="px-2 py-1.5 text-right font-medium">Events</th>
                <th className="px-2 py-1.5 text-right font-medium">Objects</th>
                {!compact ? <th className="px-2 py-1.5 text-left font-medium">Object types</th> : null}
                {!compact ? <th className="px-2 py-1.5 text-left font-medium">Start</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ExecutionRow
                  key={row.id}
                  row={row}
                  compact={compact}
                  selected={row.id === settings.executionId}
                  disabled={disabled}
                  onSelect={() => onChange({ ...settings, executionId: row.id })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {selectedMissing ? (
        <p className="text-xs text-amber-700">
          The preselected execution “{settings.executionId}” is not part of the current source.
        </p>
      ) : null}
    </div>
  );
}

function ExecutionRow({ row, selected, disabled, compact, onSelect }: {
  row: OCAlignmentExecutionSummary; selected: boolean; disabled: boolean; compact: boolean; onSelect: () => void;
}) {
  const ignored = row.ignored_object_types ?? [];
  return (
    <tr
      role="option"
      aria-selected={selected}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer border-t outline-none focus-visible:bg-muted ${
        selected ? "bg-primary/10 font-medium" : "hover:bg-muted/60"
      }`}
    >
      <td className="max-w-[220px] truncate px-3 py-1.5" title={row.id}>
        <span className="flex items-center gap-1.5">
          {row.id}
          {ignored.length ? (
            <span title={`Not in the model, will be ignored: ${ignored.join(", ")}`}>
              <AlertTriangle className="size-3.5 text-amber-600" aria-label="Has object types the model ignores" />
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.event_count.toLocaleString()}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{row.object_count.toLocaleString()}</td>
      {!compact ? (
        <td className="px-2 py-1.5 text-xs text-muted-foreground">
          {Object.entries(row.object_type_counts)
            .map(([type, n]) => `${n}× ${type}${ignored.includes(type) ? " (ignored)" : ""}`)
            .join(", ")}
        </td>
      ) : null}
      {!compact ? (
        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">{formatTime(row.start_unix)}</td>
      ) : null}
    </tr>
  );
}
