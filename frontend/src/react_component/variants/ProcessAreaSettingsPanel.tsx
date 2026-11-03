import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { columnNameError } from "./settings";
import { Field, Hint, SettingsSection, TimeoutInput } from "./VariantsSettingsPanel";
import {
  ISO_OPTIONS,
  type GroupingSettings,
  type IsoStrategy,
  type ProcessAreaColumns,
} from "./types";

export type ProcessAreaSettingsPanelProps = {
  columns: ProcessAreaColumns;
  onColumnsChange: (next: ProcessAreaColumns) => void;
  grouping: GroupingSettings;
  onGroupingChange: (next: GroupingSettings) => void;
  disabled?: boolean;
};

/** Advanced options of the "connected components per process area" method. */
export function ProcessAreaSettingsPanel({
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
      <SettingsSection
        step={1}
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
        step={2}
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
