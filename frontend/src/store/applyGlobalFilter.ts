import axios from "axios";
import { toast } from "sonner";
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
  // Publish first: every component refetches with the new rules right away
  // (cancelling whatever it was computing over the old ones), which also
  // frees the per-file lock the statistics request below has to wait for.
  // Rules that are applied already (e.g. pre-applied on file selection) are
  // not re-published, so components do not refetch for nothing.
  if (JSON.stringify(store.appliedRules) !== JSON.stringify(active)) {
    store.setApplied(active);
  }
  const { data } = await axios.post<ApplyFiltersResponse>(
    `/api/files/${fileId}/apply_filters/`,
    { filters: active },
    { _skipGlobalFilter: true },
  );
  if (JSON.stringify(useFilterStore.getState().appliedRules) === JSON.stringify(active)) {
    store.setStats(statsFromApplyResponse(data));
  }
  return active;
}


/** Logs with more events than this get a time-range filter proposed on selection. */
export const LARGE_LOG_EVENT_LIMIT = 25_000;

export type SuggestedTimeWindow = {
  needed: boolean;
  total_events: number;
  max_events: number;
  selected_events: number;
  after: number | null;
  before: number | null;
};

const autoFilterKey = (fileId: number) => `totem_autofilter_${fileId}`;

/**
 * Ask the backend for the time window covering the first `maxEvents` events
 * of the log. `needed` is false when the whole log fits.
 */
export async function fetchSuggestedTimeWindow(
  fileId: number,
  maxEvents: number = LARGE_LOG_EVENT_LIMIT,
): Promise<SuggestedTimeWindow> {
  const { data } = await axios.get<SuggestedTimeWindow>(
    `/api/files/${fileId}/suggested_time_window/`,
    { params: { max_events: maxEvents }, _skipGlobalFilter: true },
  );
  return data;
}

/**
 * The time-range rule that keeps a large log workable, or null when the log
 * is small enough or the user already dealt with this log in this session.
 *
 * Only proposed once per log and browser session (`sessionStorage`), so a
 * user who removes the filter on purpose is not nagged again when they come
 * back to the same log. Any failure yields null: the auto filter is a
 * convenience, never a blocker.
 */
export async function proposeLargeLogFilter(fileId: number): Promise<FilterRule | null> {
  try {
    if (sessionStorage.getItem(autoFilterKey(fileId))) return null;
  } catch {
    /* storage unavailable: still propose, just once per page load */
  }
  let window: SuggestedTimeWindow;
  try {
    window = await fetchSuggestedTimeWindow(fileId);
  } catch {
    return null;
  }
  try {
    sessionStorage.setItem(autoFilterKey(fileId), "1");
  } catch {
    /* ignore */
  }
  if (!window.needed || window.after == null || window.before == null) return null;
  return {
    id: `auto-${fileId}`,
    type: "time_range",
    enabled: true,
    params: { after: window.after, before: window.before },
  };
}

/**
 * Make a newly selected large log workable *before* its views mount.
 *
 * Fetches the suggested window and, when the log is large, applies the
 * time-range rule to the filter store right away and remembers it in
 * `sessionStorage` exactly like a user-made filter, so the filter bar
 * restores it and every component's first request is already filtered.
 * Resolves to the rule, or null when nothing was applied.
 */
export async function prepareLargeLogFilter(fileId: number): Promise<FilterRule | null> {
  const rule = await proposeLargeLogFilter(fileId);
  if (!rule) return null;
  useFilterStore.getState().setApplied([rule]);
  try {
    sessionStorage.setItem(`totem_filters_${fileId}`, JSON.stringify([rule]));
  } catch {
    /* ignore */
  }
  toast.info("Large event log: showing the first events only", {
    description:
      `This log has more than ${LARGE_LOG_EVENT_LIMIT.toLocaleString()} events, so a global time-range ` +
      "filter was applied to keep the analyses responsive. Adjust or remove it in the filter bar.",
    duration: 10000,
  });
  // Statistics for the filter header arrive in the background.
  applyGlobalFilterRules(fileId, [rule]).catch(() => {});
  return rule;
}
