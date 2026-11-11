import { AppSidebar } from "@/components/app-sidebar"
import { useContext, useEffect } from "react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";
import { AnalysisView } from "./components/AnalysisView";
import { OccnConformanceView } from "./components/occn-conformance/OccnConformanceView";
import { TotemConformanceView } from "./components/totem-conformance/TotemConformanceView";
import { OcpnFlattenedReplayView } from "./components/ocpn-flattened-replay/OcpnFlattenedReplayView";
import { OCAlignmentView } from "./components/oc-alignment/OCAlignmentView";
import { ModelAssetsView } from "./components/ModelAssetsView";
import { ImageAssetsView } from "./components/ImageAssetsView";
import { QueryAssetsView } from "./components/QueryAssetsView";
import { ProcessAreaAssetsView } from "./components/ProcessAreaAssetsView";
import { EditorView } from "./editors/EditorView";
import { PlayoutView } from "./playout/PlayoutView";
import Grid from './components/grid';
import FilterChipStack from "@/components/FilterChipStack";
import ComputationPanel from "@/components/ComputationPanel";
import { FilterStackProvider } from "@/contexts/FilterStackContext";

/**
 * On a phone the sidebar is a drawer over the page. Picking a view from it
 * should reveal that view, so the drawer closes on every view change.
 */
function CloseMobileSidebarOnNavigate() {
  const { viewMode } = useContext(DashboardContext);
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [viewMode, setOpenMobile]);
  return null;
}

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
      case 'imageAssets':
        return <ImageAssetsView />;
      case 'queryAssets':
        return <QueryAssetsView initialAssetId={viewMode.openAssetId} />;
      case 'processAreaAssets':
        return <ProcessAreaAssetsView />;
      case 'conformance':
        if (viewMode.component === 'totem') {
          return <TotemConformanceView initialAssetId={viewMode.assetId} />;
        }
        if (viewMode.component === 'ocpnReplay') {
          return <OcpnFlattenedReplayView initialAssetId={viewMode.assetId} />;
        }
        if (viewMode.component === 'ocAlignment') {
          return <OCAlignmentView initialAssetId={viewMode.assetId} />;
        }
        return <OccnConformanceView initialAssetId={viewMode.assetId} />;
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
      <CloseMobileSidebarOnNavigate />
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
          <ComputationPanel />
        </FilterStackProvider>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default ProcessOverview;
