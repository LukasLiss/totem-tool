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

type FilterStackContextType = {
  filters: FilterRule[];
  addFilter: (rule: Omit<FilterRule, "id">) => void;
  removeFilter: (id: string) => void;
};

const defaultCtx: FilterStackContextType = {
  filters: [],
  addFilter: () => {},
  removeFilter: () => {},
};

export const FilterStackContext = createContext<FilterStackContextType>(defaultCtx);

type FilterStackProviderProps = {
  children: ReactNode;
  initialFilters?: FilterRule[];
  onChange?: (filters: FilterRule[]) => void;
};

export function FilterStackProvider({
  children,
  initialFilters = [],
  onChange,
}: FilterStackProviderProps) {
  const [filters, setFilters] = useState<FilterRule[]>(initialFilters);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    onChange?.(filters);
  }, [filters, onChange]);

  const addFilter = useCallback((rule: Omit<FilterRule, "id">) => {
    const id = Math.random().toString(36).slice(2, 10);
    setFilters(prev => [...prev, { ...rule, id }]);
  }, []);

  const removeFilter = useCallback((id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id));
  }, []);

  return (
    <FilterStackContext.Provider
      value={{ filters, addFilter, removeFilter }}
    >
      {children}
    </FilterStackContext.Provider>
  );
}

export function useFilterStack() {
  return useContext(FilterStackContext);
}
