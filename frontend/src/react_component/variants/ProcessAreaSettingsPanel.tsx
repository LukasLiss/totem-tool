import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ProjectAsset } from "@/api/assetsApi";
import type { ProcessAreasSnapshot } from "@/store/processAreaStore";

import { columnNameError } from "./settings";
import { Field, Hint, SettingsSection, TimeoutInput } from "./VariantsSettingsPanel";
import {
  ISO_OPTIONS,
  type GroupingSettings,
  type IsoStrategy,
  type ProcessAreaColumns,
} from "./types";

export type ProcessAreaSettingsPanelProps = {
  /** Stored composition to use; null = the areas shown in the Process Area component. */
  areaAssetId?: number | null;
  onAreaAssetChange?: (assetId: number | null) => void;
  storedCompositions?: ProjectAsset[];
  currentProcessAreas?: ProcessAreasSnapshot | null;
  columns: ProcessAreaColumns;
  onColumnsChange: (next: ProcessAreaColumns) => void;
  grouping: GroupingSettings;
  onGroupingChange: (next: GroupingSettings) => void;
  disabled?: boolean;
};

const CURRENT = "__current__";

/** Which process areas the method runs on: the ones shown now, or a stored composition. */
export function ProcessAreaSourceSelect({
  value,
  onChange,
  storedCompositions,
  currentProcessAreas,
  disabled,
  id = "variants-area-source",
  className = "w-full",
}: {
  value: number | null;
  onChange: (assetId: number | null) => void;
  storedCompositions: Pick<ProjectAsset, "id" | "name">[];
  currentProcessAreas?: ProcessAreasSnapshot | null;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const missing = value !== null && !storedCompositions.some((asset) => asset.id === value);
  const currentLabel = currentProcessAreas?.composition?.name
    ? `Shown in the Process Area component (${currentProcessAreas.composition.name})`
    : "Shown in the Process Area component (or discovered)";
  return (
    <Select
      value={value === null ? CURRENT : String(value)}
      onValueChange={(next) => onChange(next === CURRENT ? null : Number(next))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label="Process areas" className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={CURRENT}>{currentLabel}</SelectItem>
        {storedCompositions.map((asset) => (
          <SelectItem key={asset.id} value={String(asset.id)}>
            {asset.name}
          </SelectItem>
        ))}
        {missing ? (
          <SelectItem value={String(value)} disabled>
            Deleted composition
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  );
}

/** Advanced options of the "connected components per process area" method. */
export function ProcessAreaSettingsPanel({
  areaAssetId = null,
  onAreaAssetChange,
  storedCompositions = [],
  currentProcessAreas = null,
  columns,
  onColumnsChange,
  grouping,
  onGroupingChange,
  disabled = false,
}: ProcessAreaSettingsPanelProps) {
  const isoOption = ISO_OPTIONS.find((o) => o.value === grouping.iso);
  const executionError = columnNameError(columns.executionColumn);
  const variantError = columnNameError(columns.variantColumn);

  return (
    <div className="flex flex-wrap gap-3">
      {onAreaAssetChange ? (
        <SettingsSection
          step={1}
          title="Process areas"
          description="The process areas whose executions are compared, one variant list per area."
        >
          <Field label="Process areas" htmlFor="variants-area-source">
            <ProcessAreaSourceSelect
              value={areaAssetId}
              onChange={onAreaAssetChange}
              storedCompositions={storedCompositions}
              currentProcessAreas={currentProcessAreas}
              disabled={disabled}
            />
            <Hint>
              Compositions adjusted and saved in the Process Area component are stored in the
              project assets and keep their area names.
            </Hint>
          </Field>
        </SettingsSection>
      ) : null}
      <SettingsSection
        step={onAreaAssetChange ? 2 : 1}
        title="Variant grouping"
        description="Executions with the same structure form one variant."
      >
        <Field label="Isomorphism strategy" htmlFor="variants-iso">
          <Select
            value={grouping.iso}
            onValueChange={(value) => onGroupingChange({ ...grouping, iso: value as IsoStrategy })}
            disabled={disabled}
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
        <Field label="Timeout per process area (seconds)" htmlFor="variants-timeout">
          <TimeoutInput
            value={grouping.timeoutS}
            onChange={(timeoutS) => onGroupingChange({ ...grouping, timeoutS })}
            disabled={disabled}
          />
        </Field>
      </SettingsSection>

      <SettingsSection
        step={onAreaAssetChange ? 3 : 2}
        title="Store in event log"
        description="Every event gets the id of its process execution and of its variant."
      >
        <Field label="Execution column" htmlFor="variants-area-execution-column" error={executionError}>
          <Input
            id="variants-area-execution-column"
            value={columns.executionColumn}
            onChange={(event) => onColumnsChange({ ...columns, executionColumn: event.target.value })}
            disabled={disabled}
            aria-invalid={executionError !== null}
          />
        </Field>
        <Field label="Variant column" htmlFor="variants-area-variant-column" error={variantError}>
          <Input
            id="variants-area-variant-column"
            value={columns.variantColumn}
            onChange={(event) => onColumnsChange({ ...columns, variantColumn: event.target.value })}
            disabled={disabled}
            aria-invalid={variantError !== null}
          />
          <Hint>You are asked before an existing column is overwritten.</Hint>
        </Field>
      </SettingsSection>
    </div>
  );
}

export default ProcessAreaSettingsPanel;
