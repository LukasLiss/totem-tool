import { useContext } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardContext } from "@/contexts/DashboardContext";
import SimulationDashboard from "@/SimulationDashboard";

export function SimulationView() {
  const { viewMode } = useContext(DashboardContext);

  if (viewMode.type !== 'simulation') return null;

  return (
    <div className="flex flex-col min-h-screen">
      <SidebarTrigger className="m-2" />
      <div className="flex-1 flex justify-center p-4 pt-0">
        <div className="w-full max-w-7xl">
          <SimulationDashboard />
        </div>
      </div>
    </div>
  );
}

export default SimulationView;
