import React, { createContext, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

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
  | { type: "conformance"; component: ConformanceComponent }
  | { type: "editor"; component: EditorComponent }
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
  const [viewMode, setViewModeState] = useState<ViewMode>({ type: "overview" });
  const navigate = useNavigate();

  // Selecting any view from the navbar also navigates to the main process
  // view. This ensures full-page routes like Settings close automatically
  // when a navbar item is clicked. Navigating to the current route is a
  // no-op, so this is safe to call unconditionally.
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      navigate("/overview");
    },
    [navigate]
  );

  return (
    <DashboardContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </DashboardContext.Provider>
  );
};
