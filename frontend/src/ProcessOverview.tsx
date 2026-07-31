import { AppSidebar } from "@/components/app-sidebar"
import { useContext } from "react";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";
import { AnalysisView } from "./components/AnalysisView";
import { ConformancePlaceholderView } from "./components/ConformancePlaceholderView";
import { ModelAssetsView } from "./components/ModelAssetsView";
import { EditorView } from "./editors/EditorView";
import { PlayoutView } from "./playout/PlayoutView";
import Grid from './components/grid';

export function ProcessOverview() {
  const { viewMode } = useContext(DashboardContext);

  const renderContent = () => {
    switch (viewMode.type) {
      case 'overview':
        return <DevDashboard />;
      case 'analysis':
        return <AnalysisView />;
      case 'modelAssets':
        return <ModelAssetsView />;
      case 'conformance':
        return <ConformancePlaceholderView />;
      case 'editor':
        return <EditorView />;
      case 'playout':
        return <PlayoutView />;
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
        {renderContent()}
      </SidebarInset>
    </SidebarProvider>
  )
}

export default ProcessOverview;
