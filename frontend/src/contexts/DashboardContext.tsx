import React, { createContext, useState } from "react";

export type AnalysisComponent =
  | "processArea"
  | "ocdfg"
  | "variants"
  | "dottedChart"
  | "occn";
export type ConformanceComponent = "totem" | "occn";

export type EditorComponent = "totem" | "occn" | "ocpn";

export type ViewMode =
  | { type: "overview" }
  | { type: "modelAssets" }
  | { type: "analysis"; component: AnalysisComponent }
  | { type: "conformance"; component: ConformanceComponent; assetId?: number }
  | { type: "editor"; component: EditorComponent; openAssetId?: number }
  | { type: "dashboard"; id: number };

type DashboardContextType = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
};

export const DashboardContext = createContext<DashboardContextType>({
  viewMode: { type: "overview" },
  setViewMode: () => {},
});

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>({ type: "overview" });

  return (
    <DashboardContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </DashboardContext.Provider>
  );
};
