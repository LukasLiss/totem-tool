import React, { createContext, useState } from "react";

export type AnalysisComponent = 'processArea' | 'ocdfg' | 'variants' | 'dottedChart';
export type ConformanceComponent = 'totem' | 'occn';

export type ViewMode =
  | { type: 'eventLogs' }
  | { type: 'modelAssets' }
  | { type: 'analysis'; component: AnalysisComponent }
  | { type: 'conformance'; component: ConformanceComponent }
  | { type: 'dashboard'; id: number };

type DashboardContextType = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
};

export const DashboardContext = createContext<DashboardContextType>({
  viewMode: { type: 'eventLogs' },
  setViewMode: () => {},
});

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [viewMode, setViewMode] = useState<ViewMode>({ type: 'eventLogs' });

  return (
    <DashboardContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </DashboardContext.Provider>
  );
};
