import { DashboardContext } from "@/contexts/DashboardContext";
import { useContext, useEffect } from "react";

export function DashboardView() {
  const { viewMode } = useContext(DashboardContext);

  // Extract dashboard ID when in dashboard mode
  const dashboardId = viewMode.type === 'dashboard' ? viewMode.id : null;

  useEffect(() => {
    if (!dashboardId) return;
    console.log("DashboardView: active dashboard is", dashboardId);
  }, [dashboardId]);

  return (
    <div className="p-4">
      <h2>Dashboard {dashboardId}</h2>
      {/* render charts, tables, etc */}
    </div>
  );
}
