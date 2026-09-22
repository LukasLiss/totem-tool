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
