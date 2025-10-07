import { DashboardContext } from "@/contexts/DashboardContext";
import { useContext, useEffect } from "react";

export function DashboardView() {
  const { selectedDashboard } = useContext(DashboardContext);

  useEffect(() => {
    if (!selectedDashboard) return;
    console.log("DevDashboard: active dashboard is", selectedDashboard.name);
  }, [selectedDashboard]);

  return (
    <div className="p-4">
      <h2>{selectedDashboard?.name}</h2>
      {/* render charts, tables, etc */}
    </div>
  );
}
