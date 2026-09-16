import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type FilterType = "time_range" | "object_types" | "activity";

export type TimeRangeParams = { after?: number; before?: number };
export type ObjectTypesParams = { include: string[] };
export type ActivityParams = { include: string[] };

export type FilterRule = {
  id: string;
  type: FilterType;
  enabled: boolean;
  params: TimeRangeParams | ObjectTypesParams | ActivityParams;
};

export type FilterRuleDraft = Omit<FilterRule, "id">;

type FilterStackContextType = {
  filters: FilterRule[];
  addFilter: (rule: FilterRuleDraft) => void;
  removeFilter: (id: string) => void;
  /**
   * Replace every rule of the given types with `rules` (other types stay).
   * Returns the resulting rule list synchronously so callers can apply it
   * right away.
   */
  replaceFilters: (types: FilterType[], rules: FilterRuleDraft[]) => FilterRule[];
};

const defaultCtx: FilterStackContextType = {
  filters: [],
  addFilter: () => {},
  removeFilter: () => {},
  replaceFilters: () => [],
};

export const FilterStackContext = createContext<FilterStackContextType>(defaultCtx);

type FilterStackProviderProps = {
  children: ReactNode;
  initialFilters?: FilterRule[];
  onChange?: (filters: FilterRule[]) => void;
};

function newRuleId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function FilterStackProvider({
  children,
  initialFilters = [],
  onChange,
}: FilterStackProviderProps) {
  const [filters, setFilters] = useState<FilterRule[]>(initialFilters);
  // Mirror of `filters` so `replaceFilters` can return the new list without
  // waiting for a re-render.
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    onChange?.(filters);
  }, [filters, onChange]);

  const addFilter = useCallback((rule: FilterRuleDraft) => {
    setFilters(prev => [...prev, { ...rule, id: newRuleId() }]);
  }, []);

  const removeFilter = useCallback((id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id));
  }, []);

  const replaceFilters = useCallback((types: FilterType[], rules: FilterRuleDraft[]) => {
    const kept = filtersRef.current.filter(f => !types.includes(f.type));
    const next = [...kept, ...rules.map(rule => ({ ...rule, id: newRuleId() }))];
    filtersRef.current = next;
    setFilters(next);
    return next;
  }, []);

  return (
    <FilterStackContext.Provider
      value={{ filters, addFilter, removeFilter, replaceFilters }}
    >
      {children}
    </FilterStackContext.Provider>
  );
}

export function useFilterStack() {
  return useContext(FilterStackContext);
}
