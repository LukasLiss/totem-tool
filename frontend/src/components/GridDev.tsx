import React, { useContext, useEffect } from "react";
import GridProvider from "../gridstack/lib/gridstackprovider"
import DashboardGrid from "../gridstack/lib/dashboard_grid";
import SidePanel from "../gridstack/lib/sidepanel";
import "../styles/grid_demo.css";
import {
  SidebarInset,
} from "@/components/ui/sidebar"
import GridContainer from "../gridstack/lib/grid_container";
import { useGrid } from "../gridstack/lib/gridstackprovider";
import { saveLayout, getLayout } from "../api/componentsApi";
import { DashboardContext } from "@/contexts/DashboardContext";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { useGridMode } from '../gridstack/lib/gridstackprovider';

// Type-safe layout items
// Removed initialWidgets - grid starts empty now

const GridContent: React.FC = () => {
  const { getLayout: getGridLayout, loadLayout, grid, resetGrid } = useGrid();
  const { viewMode } = useContext(DashboardContext);
  const { selectedFile } = useContext(SelectedFileContext);

  // Extract dashboard ID when in dashboard mode
  const selectedDashboard = viewMode.type === 'dashboard' ? viewMode.id : null;

  useEffect(() => {
    console.log("Dashboard changed to:", selectedDashboard);
    console.log("Current grid containers:", document.querySelectorAll('.grid-stack').length);
    console.log("Current grid-stack-item elements:", document.querySelectorAll('.grid-stack-item').length);

    const loadSelectedDashboard = async () => {
      console.log("Starting to load dashboard layout");

      // Completely reset the grid instance
      console.log("Resetting grid instance");
      resetGrid();

      if (!selectedDashboard) {
        console.log("No dashboard selected, staying blank");
        return;
      }
      
      const token = localStorage.getItem("access_token");
      if (!token) {
        console.log("No token found");
        return;
      }
      
      try {
        console.log("Fetching layout for dashboard:", selectedDashboard);
        const response = await getLayout(selectedDashboard, token);
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
  }, [selectedDashboard, resetGrid]);

  const handleSave = async () => {
    if (!selectedDashboard) {
      alert("No dashboard selected!");
      return;
    }
    const layout = getGridLayout();
    console.log('Layout to save:', layout); // Debug: Check what's being saved
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const response = await saveLayout(selectedDashboard, layout, token);
      console.log('Save response:', response); // Debug: Check API response
      alert("Layout saved!");
    } catch (error) {
      console.error('Save failed:', error); // Debug: Check for errors
      alert("Save failed!");
    }
  };

  const handleLoad = async () => {
    if (!selectedDashboard) {
      alert("No dashboard selected!");
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const response = await getLayout(selectedDashboard, token);
    // Small delay to ensure any pending operations complete
    setTimeout(() => loadLayout(response), 50);
  };

  const handleLog = async () => {
    console.log("Current layout:", getGridLayout());
  };
  const { isEditMode, setIsEditMode } = useGridMode();

  return (
    <div className="flex flex-col h-screen  overflow-hidden">
      <div className="flex justify-end p-2 space-x-2">
        <button
          onClick={() => {
            console.log('Edit mode button clicked, current isEditMode:', isEditMode);
            setIsEditMode(!isEditMode);
          }}
          className={`px-4 py-2 rounded ${isEditMode ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'}`}
        >
          {isEditMode ? 'Disable Edit Mode' : 'Enable Edit Mode'}
        </button>
        <button onClick={() => resetGrid()} className="bg-red-500 text-white px-4 py-2 rounded">
          Reset Grid
        </button>
        <button onClick={handleLoad} className="bg-green-500 text-white px-4 py-2 rounded">
          Load Layout
        </button>
        <button onClick={handleSave} className="bg-blue-500 text-white px-4 py-2 rounded">
          Save Layout
        </button>
        <button onClick={handleLog} className="bg-blue-500 text-white px-4 py-2 rounded">
          Log Layout
        </button>
      </div>
      <div className="flex flex-row flex-grow overflow-hidden">
        
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

const DevGrid: React.FC = () => {
  return (
  <SidebarInset>
    <GridProvider>
      <GridContent />
    </GridProvider>
  </SidebarInset>
  );
};

export default DevGrid;
