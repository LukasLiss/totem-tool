// Split out of FilterStackContext.tsx so that file exports only the
// FilterStackProvider component and types — mixing the context object and
// the hook in with it trips react-refresh/only-export-components (Fast
// Refresh can't preserve state across a hot reload of a module whose
// exports aren't all components).
import { createContext, useContext } from "react";
import type { FilterRule, FilterRuleDraft, FilterType } from "./FilterStackContext";

export type FilterStackContextType = {
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

export function useFilterStack() {
  return useContext(FilterStackContext);
}
