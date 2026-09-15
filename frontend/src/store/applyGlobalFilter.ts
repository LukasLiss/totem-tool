import axios from "axios";
import type { FilterRule } from "@/contexts/FilterStackContext";
import { useFilterStore, type FilterStats } from "@/store/filterStore";

type ApplyFiltersResponse = {
  object_percentage:   number;
  object_count_before: number;
  object_count_after:  number;
  event_percentage:    number;
  event_count_before:  number;
  event_count_after:   number;
};

export function statsFromApplyResponse(data: ApplyFiltersResponse): FilterStats {
  return {
    objectPct:    data.object_percentage,
    eventPct:     data.event_percentage,
    objectBefore: data.object_count_before,
    objectAfter:  data.object_count_after,
    eventBefore:  data.event_count_before,
    eventAfter:   data.event_count_after,
  };
}

/**
 * Make `rules` the applied global filter for `fileId`.
 *
 * Asks the backend how much of the log survives (for the filter header
 * arcs) and then publishes the rules through the filter store, which every
 * component with the global-filter toggle listens to. With no enabled rule
 * the applied filter is simply cleared.
 *
 * This is the single place that applies a filter; the filter chip stack and
 * the process-area filter action both go through it.
 */
export async function applyGlobalFilterRules(fileId: number, rules: FilterRule[]): Promise<FilterRule[]> {
  const active = rules.filter((rule) => rule.enabled);
  const store = useFilterStore.getState();
  if (active.length === 0) {
    store.clear();
    return [];
  }
  const { data } = await axios.post<ApplyFiltersResponse>(
    `/api/files/${fileId}/apply_filters/`,
    { filters: active },
    { _skipGlobalFilter: true },
  );
  store.setApplied(active, statsFromApplyResponse(data));
  return active;
}
