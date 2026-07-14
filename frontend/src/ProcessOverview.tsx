import { AppSidebar } from "@/components/app-sidebar"
import { useContext } from "react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";
import { AnalysisView } from "./components/AnalysisView";
import Grid from './components/grid';
import FilterChipStack from "@/components/FilterChipStack";
import { FilterStackProvider } from "@/contexts/FilterStackContext";

export function ProcessOverview() {
  const { viewMode } = useContext(DashboardContext);

  const renderContent = () => {
    switch (viewMode.type) {
      case 'overview':
        return <DevDashboard />;
      case 'analysis':
        return <AnalysisView />;
      case 'dashboard':
        return <Grid />;
      default:
        return <DevDashboard />;
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <FilterStackProvider>
          {viewMode.type !== 'dashboard' && (
            <header className="flex items-center gap-3 px-4 border-b bg-background" style={{ minHeight: 60 }}>
              <SidebarTrigger className="shrink-0" style={{ width: 36, height: 36 }} />
              <div className="w-px h-7 bg-border shrink-0" />
              <div className="flex-1 overflow-x-auto">
                <FilterChipStack />
              </div>
            </header>
          )}
          <div className="flex-1">
            {renderContent()}
          </div>
        </FilterStackProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default ProcessOverview;