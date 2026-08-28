import { create } from "zustand";
import type { FilterRule, TimeRangeParams, ObjectTypesParams, ActivityParams } from "@/contexts/FilterStackContext";

type FilterStore = {
  appliedRules: FilterRule[];
  isApplied:    boolean;
  version:      number;
  setApplied:   (rules: FilterRule[]) => void;
  clear:        () => void;
};

export const useFilterStore = create<FilterStore>((set) => ({
  appliedRules: [],
  isApplied:    false,
  version:      0,
  setApplied:   (rules) => set((s) => ({ appliedRules: rules, isApplied: rules.length > 0, version: s.version + 1 })),
  clear:        ()      => set((s) => ({ appliedRules: [], isApplied: false, version: s.version + 1 })),
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
