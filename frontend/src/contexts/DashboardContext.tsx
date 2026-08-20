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
  | { type: "conformance"; component: ConformanceComponent }
  | { type: "editor"; component: EditorComponent }
  | { type: "playout" }
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

  React.useEffect(() => {
    const handleSetViewMode = (e: Event) => {
      const customEvent = e as CustomEvent<{
        mode?: string;
        component?: string;
        dashboard_id?: number;
        id?: number;
      }>;
      const detail = customEvent.detail;
      if (!detail) return;

      const mode = detail.mode;
      if (mode === "overview") {
        setViewMode({ type: "overview" });
      } else if (mode === "analysis") {
        setViewMode({
          type: "analysis",
          component: (detail.component as AnalysisComponent) || "processArea",
        });
      } else if (mode === "dashboard" && (detail.dashboard_id || detail.id)) {
        setViewMode({
          type: "dashboard",
          id: (detail.dashboard_id || detail.id)!,
        });
      } else if (mode === "playout") {
        setViewMode({ type: "playout" });
      } else if (mode === "editor") {
        setViewMode({
          type: "editor",
          component: (detail.component as EditorComponent) || "totem",
        });
      } else if (mode === "modelAssets") {
        setViewMode({ type: "modelAssets" });
      } else if (mode === "conformance") {
        setViewMode({
          type: "conformance",
          component: (detail.component as ConformanceComponent) || "totem",
        });
      }
    };

    window.addEventListener("agent:setViewMode", handleSetViewMode);
    return () => {
      window.removeEventListener("agent:setViewMode", handleSetViewMode);
    };
  }, []);

  return (
    <DashboardContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </DashboardContext.Provider>
  );
};

