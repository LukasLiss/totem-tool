import { create } from "zustand";
import type { FilterRule, TimeRangeParams, ObjectTypesParams, ActivityParams } from "@/contexts/FilterStackContext";

/** How much of the log survives the applied global filter. */
export type FilterStats = {
  objectPct:    number;
  eventPct:     number;
  objectBefore: number;
  objectAfter:  number;
  eventBefore:  number;
  eventAfter:   number;
};

type FilterStore = {
  /** Rules currently applied to the data endpoints (see the axios interceptor). */
  appliedRules: FilterRule[];
  isApplied:    boolean;
  /** Bumped on every change so components can refetch. */
  version:      number;
  /** Object/event counts for the applied rules; `null` until a log is known. */
  stats:        FilterStats | null;
  setApplied:   (rules: FilterRule[], stats?: FilterStats | null) => void;
  setStats:     (stats: FilterStats | null) => void;
  /** Drop the applied rules. Existing stats fall back to "everything kept". */
  clear:        () => void;
};

function unfilteredStats(stats: FilterStats | null): FilterStats | null {
  if (!stats) return null;
  return {
    ...stats,
    objectPct: 1,
    eventPct: 1,
    objectAfter: stats.objectBefore,
    eventAfter: stats.eventBefore,
  };
}

export const useFilterStore = create<FilterStore>((set) => ({
  appliedRules: [],
  isApplied:    false,
  version:      0,
  stats:        null,
  setApplied:   (rules, stats) => set((s) => ({
    appliedRules: rules,
    isApplied: rules.length > 0,
    version: s.version + 1,
    stats: stats === undefined ? s.stats : stats,
  })),
  setStats:     (stats) => set({ stats }),
  clear:        () => set((s) => ({
    appliedRules: [],
    isApplied: false,
    version: s.version + 1,
    stats: unfilteredStats(s.stats),
  })),
}));

export function useFilterVersion() {
  return useFilterStore((s) => s.version);
}

export function buildFilterParams(rules: FilterRule[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.type === "time_range") {
      const p = rule.params as TimeRangeParams;
      if (p.after  != null) params.after  = String(p.after);
      if (p.before != null) params.before = String(p.before);
    } else if (rule.type === "object_types") {
      const p = rule.params as ObjectTypesParams;
      if (p.include.length > 0) params.object_types = p.include.join(",");
    } else if (rule.type === "activity") {
      const p = rule.params as ActivityParams;
      if (p.include.length > 0) params.activities = p.include.join(",");
    }
  }
  return params;
}

/**
 * Merge global and local filter params with intersection semantics:
 * - Date range: take the tighter window (max after, min before)
 * - Activities / object_types: comma-separated intersection
 */
function mergeFilterParamsIntersection(
  globalParams: Record<string, string>,
  localParams: Record<string, string>,
): { merged: Record<string, string>; noResults: boolean } {
  const merged: Record<string, string> = { ...globalParams };
  let noResults = false;

  if (localParams.after != null) {
    const g = globalParams.after != null ? Number(globalParams.after) : -Infinity;
    merged.after = String(Math.max(g, Number(localParams.after)));
  }
  if (localParams.before != null) {
    const g = globalParams.before != null ? Number(globalParams.before) : Infinity;
    merged.before = String(Math.min(g, Number(localParams.before)));
  }

  if (localParams.activities != null) {
    if (globalParams.activities) {
      const globalSet = new Set(globalParams.activities.split(","));
      const hit = localParams.activities.split(",").filter((a) => globalSet.has(a));
      merged.activities = hit.join(",");
      if (hit.length === 0) noResults = true;
    } else {
      merged.activities = localParams.activities;
    }
  }

  if (localParams.object_types != null) {
    if (globalParams.object_types) {
      const globalSet = new Set(globalParams.object_types.split(","));
      const hit = localParams.object_types.split(",").filter((t) => globalSet.has(t));
      merged.object_types = hit.join(",");
      if (hit.length === 0) noResults = true;
    } else {
      merged.object_types = localParams.object_types;
    }
  }

  return { merged, noResults };
}

export type EffectiveFilterConfig = {
  params?: Record<string, string>;
  _skipGlobalFilter: boolean;
  /** True when the intersection of global and local filters is empty — callers should skip fetching and render an empty state. */
  _noResults: boolean;
};

/**
 * Compute the effective axios config fragment for filter params.
 *
 * - Local inactive → let the interceptor inject global filter (or nothing).
 * - Local active, global disabled → use local params only.
 * - Both active → merge with intersection semantics
 */
export function getEffectiveFilterConfig(
  localFilterParams: Record<string, string> | undefined,
  filterEnabled: boolean,
): EffectiveFilterConfig {
  const localActive = !!localFilterParams && Object.keys(localFilterParams).length > 0;

  if (!localActive) {
    return { _skipGlobalFilter: !filterEnabled, _noResults: false };
  }

  if (!filterEnabled) {
    return { params: localFilterParams, _skipGlobalFilter: true, _noResults: false };
  }

  // Both active — merge with the current global filter state.
  const { appliedRules, isApplied } = useFilterStore.getState();
  if (!isApplied) {
    return { params: localFilterParams, _skipGlobalFilter: true, _noResults: false };
  }

  const globalParams = buildFilterParams(appliedRules);
  const { merged, noResults } = mergeFilterParamsIntersection(globalParams, localFilterParams);
  return { params: merged, _skipGlobalFilter: true, _noResults: noResults };
}
