import { LoaderCircle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ProcessAreasSnapshot } from "@/store/processAreaStore";

import { MultiSelectPopover } from "./MultiSelectPopover";
import {
  applyProcessArea,
  columnNameError,
  isLeadingExtraction,
  isResourceAware,
  matchingProcessAreaId,
  processAreaOptionLabel,
} from "./settings";
import {
  EXTRACTION_OPTIONS,
  ISO_OPTIONS,
  type ExecutionSettings,
  type Extraction,
  type GroupingSettings,
  type IsoStrategy,
  type StoreSettings,
} from "./types";

export type VariantsSettingsPanelProps = {
  execution: ExecutionSettings;
  onExecutionChange: (next: ExecutionSettings) => void;
  grouping: GroupingSettings;
  onGroupingChange: (next: GroupingSettings) => void;
  store: StoreSettings;
  onStoreChange: (next: StoreSettings) => void;
  availableTypes: string[];
  availableActivities: string[];
  optionsLoading: boolean;
  processAreas: ProcessAreasSnapshot | null;
  processAreasLoading: boolean;
  processAreasError: string | null;
  onComputeProcessAreas: () => void;
  disabled?: boolean;
};

const NO_AREA = "__none__";

/**
 * The three decisions behind a variant computation, each in its own box:
 * how executions are cut out of the log, how they are grouped into
 * variants, and whether the result is written back into the log. The boxes
 * wrap into one column on narrow widths instead of overflowing.
 */
export function VariantsSettingsPanel({
  execution,
  onExecutionChange,
  grouping,
  onGroupingChange,
  store,
  onStoreChange,
  availableTypes,
  availableActivities,
  optionsLoading,
  processAreas,
  processAreasLoading,
  processAreasError,
  onComputeProcessAreas,
  disabled = false,
}: VariantsSettingsPanelProps) {
  const extractionOption = EXTRACTION_OPTIONS.find((o) => o.value === execution.extraction);
  const isoOption = ISO_OPTIONS.find((o) => o.value === grouping.iso);
  const groupingSkipped = store.enabled && !store.computeVariants;
  const selectedAreaId = matchingProcessAreaId(execution, processAreas?.areas ?? []);
  const executionColumnError = store.enabled ? columnNameError(store.executionColumn) : null;
  const variantColumnError =
    store.enabled && store.computeVariants && store.storeVariantColumn
      ? columnNameError(store.variantColumn)
      : null;

  return (
    <div
      data-testid="variants-settings"
      className="mt-3 flex flex-wrap gap-3 rounded-md border bg-muted/30 p-3"
    >
      {/* 1 ── process executions ────────────────────────────────────────── */}
      <SettingsSection
        step={1}
        title="Process executions"
        description="How the log is cut into the executions that are compared with each other."
      >
        <Field label="Extraction" htmlFor="variants-extraction">
          <Select
            value={execution.extraction}
            onValueChange={(value) =>
              onExecutionChange({ ...execution, extraction: value as Extraction })
            }
            disabled={disabled}
          >
            <SelectTrigger id="variants-extraction" aria-label="Extraction" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXTRACTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint>{extractionOption?.hint}</Hint>
        </Field>

        {isLeadingExtraction(execution.extraction) ? (
          <Field label="Leading object type" htmlFor="variants-leading-type">
            <Select
              value={execution.leadingType || undefined}
              onValueChange={(value) => onExecutionChange({ ...execution, leadingType: value })}
              disabled={disabled || optionsLoading || availableTypes.length === 0}
            >
              <SelectTrigger id="variants-leading-type" aria-label="Leading object type" className="w-full">
                <SelectValue placeholder={optionsLoading ? "Loading types…" : "Select type"} />
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Hint>One execution per object of this type.</Hint>
          </Field>
        ) : null}

        {isResourceAware(execution.extraction) ? (
          <>
            <Field label="From a process area">
              {processAreas ? (
                <>
                  <Select
                    value={selectedAreaId ?? NO_AREA}
                    onValueChange={(value) => {
                      const area = processAreas.areas.find((a) => a.id === value);
                      if (area) onExecutionChange(applyProcessArea(execution, area));
                    }}
                    disabled={disabled || processAreas.areas.length === 0}
                  >
                    <SelectTrigger aria-label="Process area" className="w-full">
                      <SelectValue placeholder="Pick a process area" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_AREA} disabled>
                        {selectedAreaId ? "Custom selection" : "Pick a process area"}
                      </SelectItem>
                      {processAreas.areas.map((area) => (
                        <SelectItem key={area.id} value={area.id}>
                          {processAreaOptionLabel(area)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Hint>
                    Selecting an area fills in its object types and activities below
                    {processAreas.filtered ? " (areas computed on the filtered log)" : ""}.
                  </Hint>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={onComputeProcessAreas}
                    disabled={disabled || processAreasLoading}
                  >
                    {processAreasLoading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                    Compute process areas
                  </Button>
                  <Hint>
                    {processAreasError
                      ? processAreasError
                      : "No process areas computed for this log yet. Open the Process Area component or compute them here with default settings."}
                  </Hint>
                </>
              )}
            </Field>
            <Field label="Business object types">
              <MultiSelectPopover
                label="Business object types"
                options={availableTypes}
                selected={execution.businessObjectTypes}
                onChange={(businessObjectTypes) =>
                  onExecutionChange({ ...execution, businessObjectTypes })
                }
                placeholder="Select object types"
                allLabel="All object types"
                disabled={disabled}
                loading={optionsLoading}
              />
              <Hint>
                Objects of these types form the executions. Types left out (workers,
                machines, trucks…) are treated as resources and never merge executions.
              </Hint>
            </Field>
            <Field label="Business activities">
              <MultiSelectPopover
                label="Business activities"
                options={availableActivities}
                selected={execution.businessActivities}
                onChange={(businessActivities) =>
                  onExecutionChange({ ...execution, businessActivities })
                }
                placeholder="All activities"
                allLabel="All activities"
                disabled={disabled}
                loading={optionsLoading}
              />
              <Hint>
                Two business objects belong to the same execution when they share an
                event of one of these activities. Leave empty to use every activity.
              </Hint>
            </Field>
          </>
        ) : null}
      </SettingsSection>

      {/* 2 ── variant grouping ─────────────────────────────────────────── */}
      <SettingsSection
        step={2}
        title="Variant grouping"
        description={
          groupingSkipped
            ? "Skipped: only the process executions are stored."
            : "Executions with the same structure form one variant."
        }
        muted={groupingSkipped}
      >
        <Field label="Isomorphism strategy" htmlFor="variants-iso">
          <Select
            value={grouping.iso}
            onValueChange={(value) => onGroupingChange({ ...grouping, iso: value as IsoStrategy })}
            disabled={disabled || groupingSkipped}
          >
            <SelectTrigger id="variants-iso" aria-label="Isomorphism strategy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ISO_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint>{isoOption?.hint}</Hint>
        </Field>
        <Field label="Timeout (seconds)" htmlFor="variants-timeout">
          <Input
            id="variants-timeout"
            type="number"
            min={1}
            max={600}
            step={1}
            value={grouping.timeoutS}
            onChange={(event) => {
              const n = Number(event.target.value);
              onGroupingChange({ ...grouping, timeoutS: Number.isFinite(n) && n > 0 ? n : 10 });
            }}
            disabled={disabled}
            className="w-full"
          />
          <Hint>Wall-clock budget per computation; a timed-out run returns an error instead of blocking.</Hint>
        </Field>
      </SettingsSection>

      {/* 3 ── store in event log ───────────────────────────────────────── */}
      <SettingsSection
        step={3}
        title="Store in event log"
        description="Write the executions (and optionally the variants) into a column of the events table so other components can reuse them."
      >
        <SwitchRow
          id="variants-store"
          label="Store process executions"
          checked={store.enabled}
          onCheckedChange={(enabled) => onStoreChange({ ...store, enabled })}
          disabled={disabled}
        />
        {store.enabled ? (
          <>
            <Field label="Execution column" htmlFor="variants-execution-column" error={executionColumnError}>
              <Input
                id="variants-execution-column"
                value={store.executionColumn}
                onChange={(event) => onStoreChange({ ...store, executionColumn: event.target.value })}
                disabled={disabled}
                placeholder="process execution"
                aria-invalid={executionColumnError !== null}
              />
              <Hint>
                Every event of one execution gets the same id; events in no execution stay
                empty. An existing column of that name is overwritten.
              </Hint>
            </Field>
            <SwitchRow
              id="variants-compute-variants"
              label="Also compute variants"
              hint="Comparing executions with each other is the expensive part; skip it if you only need the executions."
              checked={store.computeVariants}
              onCheckedChange={(computeVariants) => onStoreChange({ ...store, computeVariants })}
              disabled={disabled}
            />
            {store.computeVariants ? (
              <>
                <SwitchRow
                  id="variants-store-variant"
                  label="Store variant id"
                  checked={store.storeVariantColumn}
                  onCheckedChange={(storeVariantColumn) => onStoreChange({ ...store, storeVariantColumn })}
                  disabled={disabled}
                />
                {store.storeVariantColumn ? (
                  <Field label="Variant column" htmlFor="variants-variant-column" error={variantColumnError}>
                    <Input
                      id="variants-variant-column"
                      value={store.variantColumn}
                      onChange={(event) => onStoreChange({ ...store, variantColumn: event.target.value })}
                      disabled={disabled}
                      placeholder="variant"
                      aria-invalid={variantColumnError !== null}
                    />
                  </Field>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </SettingsSection>
    </div>
  );
}

function SettingsSection({
  step,
  title,
  description,
  muted = false,
  children,
}: {
  step: number;
  title: string;
  description: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className={`min-w-0 flex-1 basis-[280px] space-y-3 rounded-md border bg-background p-3 ${muted ? "opacity-60" : ""}`}
    >
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="text-sm font-semibold">
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
            {step}
          </span>
          {title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>;
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {hint ? <Hint>{hint}</Hint> : null}
      </div>
    </div>
  );
}

export default VariantsSettingsPanel;
