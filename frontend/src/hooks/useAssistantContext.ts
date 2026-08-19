import { useContext } from "react";
import { useLocation } from "react-router-dom";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { DashboardContext } from "@/contexts/DashboardContext";
import type { AssistantContext } from "@/api/assistantApi";

const VIEW_ROUTE_MAP: Record<string, string> = {
  "/upload": "upload",
  "/overview": "overview",
  "/variantsview": "analysis",
};

export function useAssistantContext(): AssistantContext {
  const { selectedFile } = useContext(SelectedFileContext);
  const { viewMode } = useContext(DashboardContext);
  const location = useLocation();

  const routeBase = "/" + location.pathname.split("/").filter(Boolean)[0];
  const current_view =
    VIEW_ROUTE_MAP[routeBase] ||
    (viewMode.type === "dashboard" ? "dashboard" : viewMode.type);

  const ctx: AssistantContext = {
    current_view,
  };

  if (selectedFile?.id) {
    ctx.selected_file_id = selectedFile.id;
  }

  if (viewMode.type === "dashboard" && "id" in viewMode) {
    ctx.current_dashboard_id = viewMode.id;
  }

  return ctx;
}
