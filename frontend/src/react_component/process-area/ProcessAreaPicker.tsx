/**
 * Pick one process area — from the areas currently shown by the Process
 * Area component (or a default discovery) or from any composition stored in
 * the project assets. Used wherever a component wants "the object types and
 * activities of a process area" (Variants Explorer, OC alignments).
 */
import { useMemo } from "react";
import { LoaderCircle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProcessAreasSnapshot } from "@/store/processAreaStore";

import {
  areaDisplayName,
  sameSet,
  useProcessAreaGroups,
  type PickableArea,
  type ProcessAreaGroup,
} from "./processAreaGroups";

const NO_AREA = "__none__";

export function ProcessAreaPicker({
  current,
  projectId,
  selectedObjectTypes,
  selectedActivities,
  onPick,
  onComputeCurrent,
  computeLoading = false,
  computeError,
  disabled = false,
  triggerId,
}: {
  current: ProcessAreasSnapshot | null;
  projectId?: number | null;
  selectedObjectTypes: string[];
  selectedActivities: string[];
  onPick: (area: PickableArea, group: ProcessAreaGroup) => void;
  /** Offer computing the discovered areas when none are known yet. */
  onComputeCurrent?: () => void;
  computeLoading?: boolean;
  computeError?: string | null;
  disabled?: boolean;
  triggerId?: string;
}) {
  const { groups, loading } = useProcessAreaGroups(current, projectId);
  const selectedValue = useMemo(() => {
    for (const group of groups) {
      const match = group.areas.find(
        (area) => sameSet(area.objectTypes, selectedObjectTypes) && sameSet(area.activities, selectedActivities),
      );
      if (match) return `${group.key}::${match.id}`;
    }
    return null;
  }, [groups, selectedObjectTypes, selectedActivities]);

  const pick = (value: string) => {
    const [groupKey, areaId] = value.split("::");
    const group = groups.find((g) => g.key === groupKey);
    const area = group?.areas.find((a) => a.id === areaId);
    if (group && area) onPick(area, group);
  };

  const empty = groups.length === 0;

  return (
    <div className="space-y-1.5">
      <Select value={selectedValue ?? NO_AREA} onValueChange={pick} disabled={disabled || empty}>
        <SelectTrigger id={triggerId} aria-label="Process area" className="w-full">
          <SelectValue placeholder="Pick a process area" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_AREA} disabled>
            {selectedObjectTypes.length > 0 ? "Custom selection" : "Pick a process area"}
          </SelectItem>
          {groups.map((group, index) => (
            <SelectGroup key={group.key}>
              {index > 0 ? <SelectSeparator /> : null}
              <SelectLabel className="text-[11px]">{group.label}</SelectLabel>
              {group.areas.map((area) => (
                <SelectItem key={`${group.key}::${area.id}`} value={`${group.key}::${area.id}`}>
                  {areaDisplayName(area)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {!current && onComputeCurrent ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onComputeCurrent}
          disabled={disabled || computeLoading}
        >
          {computeLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Compute process areas
        </Button>
      ) : null}
      {empty && !loading ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {computeError ??
            "No process areas yet. Open the Process Area component, compute them here with default settings, or store a composition in the project assets."}
        </p>
      ) : null}
    </div>
  );
}

export default ProcessAreaPicker;
