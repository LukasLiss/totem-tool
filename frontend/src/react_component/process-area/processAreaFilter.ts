import type { FilterRuleDraft, FilterType } from "@/contexts/FilterStackContext";

/** The filter types a process area overwrites; the time range is kept. */
export const PROCESS_AREA_FILTER_TYPES: FilterType[] = ["object_types", "activity"];

export type ProcessAreaFilterSource = {
  objectTypes: string[];
  /** Activities assigned to the area (not claimed by a lower area). */
  activities: string[];
};

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/**
 * Which activities a process-area filter keeps.
 *
 * In the level-based view an area only shows the activities that no lower
 * area already claims, and the filter follows that. In the detailed view
 * ("show all activities") every activity of the area's object types is
 * shown, so the filter keeps all of them.
 */
export function activitiesForProcessAreaFilter(
  area: ProcessAreaFilterSource,
  detailedView: boolean,
  objectTypeToActivities: Record<string, string[]> = {},
): string[] {
  if (!detailedView) return sortedUnique(area.activities);
  const all: string[] = [];
  let known = false;
  for (const objectType of area.objectTypes) {
    const activities = objectTypeToActivities[objectType];
    if (activities) {
      known = true;
      all.push(...activities);
    }
  }
  // Without the per-type map (older payloads) the assigned activities are
  // the best information there is.
  return sortedUnique(known ? all : area.activities);
}

/** The global filter rules that keep exactly the given types/activities. */
export function buildProcessAreaFilterRules(
  objectTypes: string[],
  activities: string[],
): FilterRuleDraft[] {
  return [
    { type: "object_types", enabled: true, params: { include: sortedUnique(objectTypes) } },
    { type: "activity", enabled: true, params: { include: sortedUnique(activities) } },
  ];
}

/** "order, item" or "order, item, package +2 more" for long lists. */
export function describeObjectTypes(objectTypes: string[], max = 3): string {
  if (objectTypes.length === 0) return "no object types";
  const shown = objectTypes.slice(0, max).join(", ");
  const rest = objectTypes.length - max;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
