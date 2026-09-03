import React, { useContext, useEffect } from "react";
import GridProvider from "../gridstack/lib/gridstackprovider"
import DashboardGrid from "../gridstack/lib/dashboard_grid";
import SidePanel from "../gridstack/lib/sidepanel";
import "../styles/grid_demo.css";
import {
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button";
import GridContainer from "../gridstack/lib/grid_container";
import { useGrid } from "../gridstack/lib/gridstackprovider";
import { saveLayout, getLayout } from "../api/componentsApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { useGridMode } from '../gridstack/lib/gridstackprovider';
import {
  Settings, Save, Minus, Plus
} from "lucide-react"
import { toast } from "sonner"
import { TOUR_IDS } from "@/tour/tourIds"
import FilterChipStack from "@/components/FilterChipStack";
// Type-safe layout items
// Removed initialWidgets - grid starts empty now

const GridContent: React.FC = () => {
  const { getLayout: getGridLayout, loadLayout, grid, resetGrid } = useGrid();
  const { viewMode } = useContext(DashboardContext);

  // Extract dashboard ID when in dashboard mode
  const selectedDashboard = viewMode.type === 'dashboard' ? viewMode.id : null;

  useEffect(() => {
    console.log("Dashboard changed to:", selectedDashboard);

    const loadSelectedDashboard = async () => {
      console.log("Starting to load dashboard layout");

      // Completely reset the grid instance
      console.log("Resetting grid instance");
      resetGrid();

      if (!selectedDashboard) {
        console.log("No dashboard selected, staying blank");
        return;
      }
      
      try {
        console.log("Fetching layout for dashboard:", selectedDashboard);
        const response = await getLayout(selectedDashboard);
        console.log("Layout response:", response);
        
        if (Array.isArray(response) && response.length > 0) {
          console.log("Loading layout with", response.length, "components");
          // Small delay to ensure grid is fully initialized after reset
          setTimeout(() => loadLayout(response), 50);
        } else {
          console.log("No layout to load or empty response");
        }
      } catch (error) {
        console.error("Failed to load layout:", error);
      }
    };
    
    loadSelectedDashboard();

    const handleRefreshEvent = (e: any) => {
      const detail = e.detail;
      if (!detail?.dashboard_id || detail.dashboard_id === selectedDashboard) {
        console.log("totem:refresh-dashboard event received, refreshing grid...");
        loadSelectedDashboard();
      }
    };

    window.addEventListener("totem:refresh-dashboard", handleRefreshEvent);
    return () => {
      window.removeEventListener("totem:refresh-dashboard", handleRefreshEvent);
    };
  }, [selectedDashboard, resetGrid]);

  const handleSave = async () => {
    if (!selectedDashboard) {
      toast.error("No dashboard selected!");
      return;
    }
    const layout = getGridLayout();
    console.log('Layout to save:', layout);
    try {
      const response = await saveLayout(selectedDashboard, layout);
      console.log('Save response:', response); // Debug: Check API response
      toast.success("Layout saved!");
    } catch (error) {
      console.error('Save failed:', error); // Debug: Check for errors
      toast.error("Save failed!");
    }
  };

  const handleLoad = async () => {
    if (!selectedDashboard) {
      toast.error("No dashboard selected!");
      return;
    }
    const response = await getLayout(selectedDashboard);
    // Small delay to ensure any pending operations complete
    setTimeout(() => loadLayout(response), 50);
  };

  const handleLog = async () => {
    console.log("Current layout:", getGridLayout());
  };
  const { isEditMode, setIsEditMode } = useGridMode();

  return (
    <div className="flex flex-col h-screen  overflow-hidden">
      <div className="flex items-center gap-3 px-4 p-2 border-b bg-background" style={{ minHeight: 60 }}>
        <SidebarTrigger className="shrink-0" style={{ width: 36, height: 36 }} />
        <div className="w-px h-7 bg-border shrink-0" />
        <div className="flex-1 overflow-x-auto">
          <FilterChipStack />
        </div>
        {isEditMode ?
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSave}
          >
            <Save />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>

          : null}
        {isEditMode ?<Button
            variant="ghost"
            size="icon"
            onClick={() => {
            console.log('Edit mode button clicked, current isEditMode:', isEditMode);
            setIsEditMode(!isEditMode);}}>
            <Minus />
            <span className="sr-only">Toggle Sidebar</span>
          </Button> :
        <Button
            variant="ghost"
            size="icon"
            data-tour-id={TOUR_IDS.DASHBOARD_ADD_CARD}
            onClick={() => {
            console.log('Edit mode button clicked, current isEditMode:', isEditMode);
            setIsEditMode(!isEditMode);}}>
            <Plus />
            <span className="sr-only">Toggle Sidebar</span>
          </Button> }

      </div>
      <div className="flex flex-row flex-grow overflow-hidden" data-tour-id={TOUR_IDS.DASHBOARD_GRID}>
        
        <div className="flex-grow overflow-auto">
          <GridContainer>
            <DashboardGrid />
          </GridContainer>
        </div>
        {isEditMode ? <SidePanel /> : null}
      </div>
    </div>
  );
};

const Grid: React.FC = () => {
  const { selectedFile } = useContext(SelectedFileContext); // 👈 ADD THIS
  const { viewMode } = useContext(DashboardContext);
  const dashboardId = viewMode.type === 'dashboard' ? viewMode.id : null;
  console.log("selectedFile passed to GridProvider:", selectedFile);
  return (
  <SidebarInset>
    <GridProvider selectedFile={selectedFile} dashboardId={dashboardId}>
      <GridContent />
    </GridProvider>
  </SidebarInset>
  );
};

export default Grid;
