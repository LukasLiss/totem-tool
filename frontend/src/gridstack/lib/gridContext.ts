// Grid contexts and hooks, split out of gridstackprovider.tsx so that file
// exports only the GridProvider component — mixing hooks in with it trips
// react-refresh/only-export-components (Fast Refresh can't preserve state
// across a hot reload of a module whose exports aren't all components).
import { createContext, useContext } from "react";
import type { GridStack, GridStackWidget } from "gridstack";

export type GridLayoutItem = Omit<GridStackWidget, 'id'> & { id?: number };

export interface GridContextValue {
  grid: GridStack | null;
  addWidget: (content?: string, componentName?: string) => void;  // Updated to include componentName
  getLayout: () => GridLayoutItem[];
  loadLayout: (layout: GridLayoutItem[]) => void;
  resetGrid: () => void;
}

export const GridModeContext = createContext<{
  isEditMode: boolean;
  setIsEditMode: (mode: boolean) => void;
}>({ isEditMode: false, setIsEditMode: () => {} });

export const GridContext = createContext<GridContextValue | undefined>(undefined);

export const useGridMode = () => useContext(GridModeContext);

export const useGrid = () => {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("useGrid must be used inside GridProvider");
  return ctx;
};
