import { useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { SelectedFileContext } from "@/contexts/SelectedFileContext";
import { DashboardContext } from "@/contexts/DashboardContext";
import { AssistantContext } from "@/api/assistantApi";

/** What the assistant should know about the screen: selected log, view and open dashboard. */
export function useAssistantContext(): AssistantContext {
  const fileContext = useContext(SelectedFileContext);
  const dashboardContext = useContext(DashboardContext);
  const location = useLocation();

  return useMemo(() => {
    const selectedFile = fileContext?.selectedFile;
    const viewMode = dashboardContext?.viewMode;

    let view = "overview";
    let dashboardId: number | undefined;
    if (viewMode) {
      if (viewMode.type === "dashboard") {
        view = `dashboard:${viewMode.id}`;
        dashboardId = viewMode.id;
      } else if ("component" in viewMode) {
        view = `${viewMode.type}:${viewMode.component}`;
      } else {
        view = viewMode.type;
      }
    }

    return {
      active_file_id: selectedFile?.id ?? undefined,
      project_id: selectedFile?.project ?? undefined,
      view_mode: view,
      pathname: location?.pathname || "/",
      current_dashboard_id: dashboardId,
    };
  }, [fileContext?.selectedFile, dashboardContext?.viewMode, location?.pathname]);
}
