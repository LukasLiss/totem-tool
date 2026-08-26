import { useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { DashboardContext } from "@/contexts/DashboardContext";
import { AssistantContext } from "@/api/assistantApi";

export function useAssistantContext(overrides?: Partial<AssistantContext>): AssistantContext {
  const fileContext = useContext(SelectedFileContext);
  const dashboardContext = useContext(DashboardContext);
  const location = useLocation();

  return useMemo(() => {
    const selectedFile = fileContext?.selectedFile;
    const viewMode = dashboardContext?.viewMode;

    let viewModeStr = "overview";
    let currentDashboardId: number | undefined = undefined;

    if (viewMode) {
      if (viewMode.type === "dashboard" && "id" in viewMode) {
        viewModeStr = `dashboard:${viewMode.id}`;
        currentDashboardId = viewMode.id;
      } else if (viewMode.type === "analysis" && "component" in viewMode) {
        viewModeStr = `analysis:${viewMode.component}`;
      } else {
        viewModeStr = viewMode.type;
      }
    }

    const payload: AssistantContext = {
      active_file_id: selectedFile?.id ?? undefined,
      selected_file_id: selectedFile?.id ?? undefined,
      view_mode: viewModeStr,
      pathname: location?.pathname || "/",
      current_dashboard_id: currentDashboardId,
      session_id: localStorage.getItem("totem_chat_session_id") || "active-session",
      ...overrides,
    };

    return payload;
  }, [fileContext?.selectedFile, dashboardContext?.viewMode, location?.pathname, overrides]);
}
