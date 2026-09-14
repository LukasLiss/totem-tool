import React, { createContext, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export type AnalysisComponent =
  | "processArea"
  | "ocdfg"
  | "variants"
  | "dottedChart"
  | "occn"
  | "ocPetriNet"
  | "totemMiner"
  | "sqlQuery";
export type ConformanceComponent = "totem" | "occn";

export type EditorComponent = "totem" | "occn" | "ocpn" | "ocdfg" | "ocel";

export type ViewMode =
  | { type: "overview" }
  | { type: "modelAssets" }
  | { type: "imageAssets" }
  | { type: "queryAssets"; openAssetId?: number }
  | { type: "analysis"; component: AnalysisComponent }
  | { type: "conformance"; component: ConformanceComponent; assetId?: number }
  | { type: "editor"; component: EditorComponent; openAssetId?: number }
  | { type: "playout" }
  | { type: "dashboard"; id: number };

/**
 * Veto over a pending view change. Return true to let it through, false to
 * block it — a blocking guard is expected to ask the user and re-issue the
 * navigation itself once they agree. Used by the dashboard's edit mode so
 * unsaved layout changes are not dropped silently.
 */
export type NavigationGuard = (next: ViewMode) => boolean;

type DashboardContextType = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** Install the guard, or pass null to remove it. Only one can be active. */
  registerNavigationGuard?: (guard: NavigationGuard | null) => void;
};

export const DashboardContext = createContext<DashboardContextType>({
  viewMode: { type: "overview" },
  setViewMode: () => {},
  registerNavigationGuard: () => {},
});

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [viewMode, setViewModeState] = useState<ViewMode>({ type: "overview" });
  const navigate = useNavigate();
  const navigationGuard = useRef<NavigationGuard | null>(null);

  const registerNavigationGuard = useCallback(
    (guard: NavigationGuard | null) => {
      navigationGuard.current = guard;
    },
    []
  );

  // Selecting any view from the navbar also navigates to the main process
  // view. This ensures full-page routes like Settings close automatically
  // when a navbar item is clicked. Navigating to the current route is a
  // no-op, so this is safe to call unconditionally.
  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (navigationGuard.current && !navigationGuard.current(mode)) return;
      setViewModeState(mode);
      navigate("/overview");
    },
    [navigate]
  );

  return (
    <DashboardContext.Provider
      value={{ viewMode, setViewMode, registerNavigationGuard }}
    >
      {children}
    </DashboardContext.Provider>
  );
};
