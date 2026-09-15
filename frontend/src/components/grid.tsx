import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
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
import {
  DashboardContext,
  type ViewMode,
} from "@/contexts/DashboardContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { useGridMode } from '../gridstack/lib/gridstackprovider';
import {
  Settings, Save, Pencil, X
} from "lucide-react"
import { toast } from "sonner"
import FilterChipStack from "@/components/FilterChipStack";
// Type-safe layout items
// Removed initialWidgets - grid starts empty now

/**
 * Fingerprint of a dashboard layout, used to spot unsaved edits.
 *
 * Only what edit mode actually manipulates — which widgets are on the grid and
 * where they sit. The rest of a saved component is deliberately ignored:
 *
 *  - `component_id` is minted fresh on every getLayout() call for widgets that
 *    carry none, because GridStack's save() hands back copies of its nodes and
 *    the id never sticks.
 *  - Component props are rewritten by the widgets themselves at runtime (a
 *    VariantsComponent re-publishes its leading object type after each render),
 *    so they change with no user edit behind them.
 *
 * Both would report a change where none was made, and a warning that cries
 * wolf is worse than no warning.
 */
type LayoutFingerprintItem = {
  component_name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

const layoutFingerprint = (layout: LayoutFingerprintItem[]): string =>
  JSON.stringify(
    layout.map((item) => ({
      component_name: item.component_name,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }))
  );

const GridContent: React.FC = () => {
  const { getLayout: getGridLayout, loadLayout, grid, resetGrid } = useGrid();
  const { viewMode, setViewMode, registerNavigationGuard } =
    useContext(DashboardContext);
  const { isEditMode, setIsEditMode } = useGridMode();

  // Extract dashboard ID when in dashboard mode
  const selectedDashboard = viewMode.type === 'dashboard' ? viewMode.id : null;

  // The layout as it was when edit mode was entered (or last saved). Null
  // while not editing. Everything below compares against this to decide
  // whether leaving edit mode would throw work away.
  const savedLayoutRef = useRef<string | null>(null);
  const getGridLayoutRef = useRef(getGridLayout);
  // Set while a confirmed navigation is being re-issued, so the guard we are
  // still registered with lets that one through.
  const allowNavigationRef = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState<ViewMode | null>(null);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  useEffect(() => {
    getGridLayoutRef.current = getGridLayout;
  });

  const hasUnsavedChanges = useCallback(() => {
    if (savedLayoutRef.current === null) return false;
    return layoutFingerprint(getGridLayoutRef.current()) !== savedLayoutRef.current;
  }, []);

  useEffect(() => {
    savedLayoutRef.current = isEditMode
      ? layoutFingerprint(getGridLayoutRef.current())
      : null;
  }, [isEditMode]);

  // While editing, a sidebar click has to ask before it drops the layout.
  useEffect(() => {
    if (!isEditMode || !registerNavigationGuard) return;
    registerNavigationGuard((next) => {
      if (allowNavigationRef.current || !hasUnsavedChanges()) return true;
      setPendingNavigation(next);
      setIsConfirmingDiscard(true);
      return false;
    });
    return () => registerNavigationGuard(null);
  }, [isEditMode, registerNavigationGuard, hasUnsavedChanges]);

  useEffect(() => {

    const loadSelectedDashboard = async () => {

      // Completely reset the grid instance
      resetGrid();

      if (!selectedDashboard) {
        return;
      }
      
      try {
        const response = await getLayout(selectedDashboard);
        
        if (Array.isArray(response) && response.length > 0) {
          // Small delay to ensure grid is fully initialized after reset
          setTimeout(() => loadLayout(response), 50);
        } else {
        }
      } catch {
        toast.error("Dashboard layout could not be loaded");
      }
    };
    
    loadSelectedDashboard();
  }, [selectedDashboard, resetGrid]);

  const handleSave = async () => {
    if (!selectedDashboard) {
      toast.error("No dashboard selected!");
      return;
    }
    const layout = getGridLayout();
    try {
      await saveLayout(selectedDashboard, layout);
      savedLayoutRef.current = layoutFingerprint(layout);
      toast.success("Layout saved!");
    } catch {
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
  };

  /**
   * Throw away the unsaved edits by reloading the dashboard as stored.
   * `loadLayout` clears the grid itself, so this must not reset it first —
   * resetting empties the container GridStack renders into and the widgets
   * then fail to come back.
   */
  const reloadSavedLayout = useCallback(async () => {
    if (!selectedDashboard) {
      resetGrid();
      return;
    }
    try {
      const response = await getLayout(selectedDashboard);
      loadLayout(Array.isArray(response) ? response : []);
    } catch {
      toast.error("Dashboard layout could not be reloaded");
    }
  }, [selectedDashboard, resetGrid, loadLayout]);

  const requestExitEditMode = () => {
    if (!hasUnsavedChanges()) {
      setIsEditMode(false);
      return;
    }
    setPendingNavigation(null);
    setIsConfirmingDiscard(true);
  };

  const keepEditing = () => {
    setIsConfirmingDiscard(false);
    setPendingNavigation(null);
  };

  const discardChanges = () => {
    setIsConfirmingDiscard(false);
    setIsEditMode(false);
    const next = pendingNavigation;
    setPendingNavigation(null);

    if (next) {
      // The grid unmounts with the view, so there is nothing to reload.
      allowNavigationRef.current = true;
      setViewMode(next);
      allowNavigationRef.current = false;
      return;
    }
    void reloadSavedLayout();
  };

  return (
    <div className="flex flex-col h-screen  overflow-hidden">
      <div className="flex items-center gap-3 px-4 p-2 border-b bg-background" style={{ minHeight: 60 }}>
        <SidebarTrigger className="shrink-0" style={{ width: 36, height: 36 }} />
        <div className="w-px h-7 bg-border shrink-0" />
        <div className="flex-1 overflow-x-auto">
          <FilterChipStack />
        </div>
        {isEditMode ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSave}
              title="Save layout"
            >
              <Save />
              <span className="sr-only">Save layout</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={requestExitEditMode}
              title="Leave edit mode"
            >
              <X />
              <span className="sr-only">Leave edit mode</span>
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsEditMode(true)}
            title="Edit dashboard"
          >
            <Pencil />
            <span className="sr-only">Edit dashboard</span>
          </Button>
        )}

      </div>
      <div className="flex flex-row flex-grow overflow-hidden">
        
        <div className="flex-grow overflow-auto">
          <GridContainer>
            <DashboardGrid />
          </GridContainer>
        </div>
        {isEditMode ? <SidePanel /> : null}
      </div>

      <Dialog
        open={isConfirmingDiscard}
        onOpenChange={(open) => {
          if (!open) keepEditing();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard layout changes?</DialogTitle>
            <DialogDescription>
              This dashboard has layout changes that have not been saved.
              Leaving edit mode now loses them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={keepEditing}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={discardChanges}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Grid: React.FC = () => {
  const { selectedFile } = useContext(SelectedFileContext); // 👈 ADD THIS
  const { viewMode } = useContext(DashboardContext);
  const dashboardId = viewMode.type === 'dashboard' ? viewMode.id : null;
  return (
  <SidebarInset>
    <GridProvider selectedFile={selectedFile} dashboardId={dashboardId}>
      <GridContent />
    </GridProvider>
  </SidebarInset>
  );
};

export default Grid;
