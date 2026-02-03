import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
  ReactNode,
} from "react";
import ReactDOM from "react-dom/client";
import { GridStack, GridStackNode, GridStackOptions } from "gridstack";
import { componentMap } from "../../components/componentMap";

interface GridContextValue {
  grid: GridStack | null;
  gridRef: React.RefObject<HTMLDivElement>;
  addWidget: (content?: string) => void;
  getLayout: () => any[];
  loadLayout: (layout: any[]) => void;
  resetGrid: () => void;
}

const GridModeContext = createContext<{
  isEditMode: boolean;
  setIsEditMode: (mode: boolean) => void;
}>({ isEditMode: false, setIsEditMode: () => {} });

interface GridProviderProps {
  children: ReactNode;
  options?: GridStackOptions;
  selectedFile: any;
}

export const useGridMode = () => useContext(GridModeContext);

const GridContext = createContext<GridContextValue | undefined>(undefined);

export const useGrid = () => {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("useGrid must be used inside GridProvider");
  return ctx;
};

interface GridProviderProps {
  children: ReactNode;
  options?: GridStackOptions;
}

export const GridProvider: React.FC<GridProviderProps> = ({
  children,
  options,
  selectedFile,
}) => {
  const gridRef = useRef<GridStack | null>(null);
  const [grid, setGrid] = useState<GridStack | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);


  // Define grid options here so resetGrid can access them
  const gridOptions: GridStackOptions = {
    cellHeight: 70,
    acceptWidgets: true,
    removable: "#trash",
    float: true,
    ...(options || {}),
  };

  useEffect(() => {
    // Initialize GridStack without renderCB (set later)
    const instance = GridStack.init(gridOptions);
    gridRef.current = instance;
    setGrid(instance);

    return () => instance.destroy(false);
  }, []); // Empty dependency: run once on mount

  // Separate effect for setting renderCB and updating grid static state when edit mode changes
  useEffect(() => {
    console.log('GridProvider useEffect - isEditMode changed to:', isEditMode);
    // Update renderCB with current isEditMode
    GridStack.renderCB = (el: HTMLElement, w: GridStackNode) => {
      const component_name = (w as any).component_name || el.dataset.componentName;
      const Component = componentMap[component_name];

      if (Component) {
        el.innerHTML = '';
        const root = ReactDOM.createRoot(el);
        root.render(
          <Component
            node={w}
            isEditMode={isEditMode} // Use current isEditMode
            selectedFile={selectedFile}
            onUpdate={(updates) => {
              Object.assign(w, updates);
              gridRef.current?.update(el, updates);
            }}
          />
        );
        (el as any)._reactRoot = root;
        (el as any).gridstackNode = w; // Store node for re-rendering
      } else {
        el.innerHTML = w.content || '';
      }
    };

    if (grid) {
      grid.setStatic(!isEditMode); // Lock grid when not in edit mode
      console.log('Grid setStatic called with:', !isEditMode);
      // Re-render all components with updated isEditMode
      const items = document.querySelectorAll('.grid-stack-item');
      console.log('Found grid items to re-render:', items.length);
      items.forEach((item, index) => {
        console.log(`Re-rendering item ${index}`);
        const root = (item as any)._reactRoot;
        const node = (item as any).gridstackNode;
        const component_name = (node as any)?.component_name || item.dataset.componentName;
        console.log(`Item ${index} - component_name: ${component_name}, node:`, node);
        const Component = componentMap[component_name];
        if (root && Component && node) {
          console.log(`Re-rendering component for item ${index}`);
          root.render(
            <Component
              node={node}
              isEditMode={isEditMode}
              selectedFile={selectedFile}
              onUpdate={(updates) => {
                Object.assign(node, updates);
                gridRef.current?.update(item as HTMLElement, updates);
              }}
            />
          );
        } else {
          console.log(`Skipping re-render for item ${index} - missing root, Component, or node`);
        }
      });
    } else {
      console.log('No grid instance to update');
    }
  }, [isEditMode, grid, selectedFile]);


  const resetGrid = () => {
    console.log("Resetting grid completely");
    try {
      // Clear all widgets and reset the grid state without destroying
      if (grid) {
        console.log("Clearing all widgets");
        grid.removeAll(true);
        
        // Clear the DOM manually to ensure clean state
        if (gridRef.current) {
          console.log("Clearing DOM");
          gridRef.current.innerHTML = '';
        }
        
        console.log("Grid reset complete - kept instance");
      } else {
        console.log("No grid instance to reset");
      }
    } catch (error) {
      console.warn("Error resetting grid:", error);
      // If reset fails, try to recreate the grid
      try {
        if (gridRef.current) {
          gridRef.current.innerHTML = '';
          const newGrid = GridStack.init(gridOptions, gridRef.current);
          setGrid(newGrid);
          console.log("Grid recreated after reset failure");
        }
      } catch (recreateError) {
        console.error("Failed to recreate grid:", recreateError);
      }
    }
  };

  const getLayout = () => {
    if (!gridRef.current) return [];
    const nodes = gridRef.current.save(false) as GridStackNode[];
    return nodes.map((node, index) => {
      // Use component_name from the node, fallback to data attribute or content-based logic
      let component_name = (node as any).component_name || node.el?.dataset.componentName || "TextBoxComponent";
      let props: any = {};
      const w =
        node.w ??
        1; // necessary because GS sets w=1 to undefined
      const h =
        node.h ??
        1; // necessary because GS sets h=1 to undefined
      if (component_name === "NumberofEventsComponent") {
        props = { color: "blue" };
      } else if (component_name === "TextBoxComponent") {
        props = { text: (node as any).text || "Enter text here", font_size: 14 };  // Read from node.text
      } else if (component_name === "VariantsComponent") {
        props = {
          automatic_loading: (node as any).automatic_loading ?? false,
          leading_object_type: (node as any).leading_object_type ?? '',
        };
      } else if (component_name === "LogStatisticsComponent") {
        props = {
          show_num_events: (node as any).show_num_events ?? true,
          show_num_activities: (node as any).show_num_activities ?? true,
          show_num_objects: (node as any).show_num_objects ?? true,
          show_num_object_types: (node as any).show_num_object_types ?? true,
          show_earliest_timestamp: (node as any).show_earliest_timestamp ?? false,
          show_newest_timestamp: (node as any).show_newest_timestamp ?? false,
          show_duration: (node as any).show_duration ?? false,
        };
      } else if (component_name === "OCDFGComponent") {
        props = {
          show_controls: (node as any).show_controls ?? true,
          initial_interaction_locked: (node as any).initial_interaction_locked ?? true,
        };
      } else if (component_name === "TotemModelComponent") {
        props = {
          initial_tau: (node as any).initial_tau ?? 0.9,
        };
      } else {
        props = { text: node.el ? node.el.innerHTML.trim() : "", font_size: 14 };
      }
      
      return {
        component_name,
        x: node.x,
        y: node.y,
        w,
        h,
        order: index,
        ...props,
      };
    });
  };

  const loadLayout = (layout: any[]) => {
    console.log("loadLayout called with:", layout);
    
    if (!gridRef.current) {
      console.log("No grid container found");
      return;
    }
    
    if (!Array.isArray(layout)) {
      console.error("loadLayout received invalid layout:", layout);
      // Try to reset the grid if it's in a bad state
      try {
        if (grid) grid.removeAll(false);
      } catch (error) {
        console.warn("Error clearing grid:", error);
        resetGrid();
      }
      return;
    }
    
    console.log("Clearing grid before loading new layout");
    try {
      gridRef.current.removeAll(true);
    } catch (error) {
      console.warn("Error clearing grid, resetting:", error);
      resetGrid();
      // After reset, try again
      if (grid) {
        try {
          grid.removeAll(true);
        } catch (retryError) {
          console.error("Failed to clear grid even after reset:", retryError);
          return;
        }
      }
    }
    
    // Check DOM after clearing
    const gridContainer = document.querySelector('.grid-stack');
    console.log("DOM elements after clear:", gridContainer?.children.length || 0);
    
    if (layout.length > 0) {
      console.log("Adding", layout.length, "widgets");
      layout.forEach((item, index) => {
        console.log(`Adding widget ${index}:`, item);
        let content = "";
        if (item.component_name === "NumberOfEventsComponent") {
          content = "Number of Events";
        } else if (item.component_name === "TextBoxComponent") {
          content = "Text Box";
        } else if (item.component_name === "ImageComponent") {
          content = "Image Component";
        } else if (item.component_name === "VariantsComponent") {
          content = "Variants Explorer";
        } else if (item.component_name === "ProcessAreaComponent") {
          content = "Process Area";
        } else if (item.component_name === "LogStatisticsComponent") {
          content = "Log Statistics";
        } else if (item.component_name === "OCDFGComponent") {
          content = "OCDFG";
        } else if (item.component_name === "TotemModelComponent") {
          content = "TOTeM Model";
        } else {
          content = "Unknown";
        }
        
        try {
          const widgetEl = gridRef.current?.addWidget({
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
            content,  // Keep for GridStack compatibility
            text: item.text,
            component_name: item.component_name,
            color: item.color,
            font_size: item.font_size,
            image: item.image,
            automatic_loading: item.automatic_loading,
            leading_object_type: item.leading_object_type,
            // LogStatisticsComponent properties
            show_num_events: item.show_num_events,
            show_num_activities: item.show_num_activities,
            show_num_objects: item.show_num_objects,
            show_num_object_types: item.show_num_object_types,
            show_earliest_timestamp: item.show_earliest_timestamp,
            show_newest_timestamp: item.show_newest_timestamp,
            show_duration: item.show_duration,
            // OCDFGComponent properties
            show_controls: item.show_controls,
            initial_interaction_locked: item.initial_interaction_locked,
            // TotemModelComponent properties
            initial_tau: item.initial_tau,
          });
          // After adding, ensure custom properties are on the node
          if (widgetEl) {
            const node = gridRef.current?.getGridItems().find(gridItem => gridItem.el === widgetEl)?.gridstackNode;
            if (node) {
              (node as any).component_name = item.component_name;
              (node as any).text = item.text;
              (node as any).color = item.color; // For NumberOfEventsComponent
              (node as any).font_size = item.font_size;
              (node as any).image = item.image; // For ImageComponent
              (node as any).automatic_loading = item.automatic_loading; // For VariantsComponent
              (node as any).leading_object_type = item.leading_object_type; // For VariantsComponent
              // LogStatisticsComponent properties
              (node as any).show_num_events = item.show_num_events;
              (node as any).show_num_activities = item.show_num_activities;
              (node as any).show_num_objects = item.show_num_objects;
              (node as any).show_num_object_types = item.show_num_object_types;
              (node as any).show_earliest_timestamp = item.show_earliest_timestamp;
              (node as any).show_newest_timestamp = item.show_newest_timestamp;
              (node as any).show_duration = item.show_duration;
              // OCDFGComponent properties
              (node as any).show_controls = item.show_controls;
              (node as any).initial_interaction_locked = item.initial_interaction_locked;
              // TotemModelComponent properties
              (node as any).initial_tau = item.initial_tau;
            }
          }
          // Set data attribute for persistence
          if (widgetEl) {
            widgetEl.dataset.componentName = item.component_name;
          }
          console.log("Widget added:", widgetEl);
        } catch (error) {
          console.error(`Error adding widget ${index}:`, error);
        }
      });
    } else {
      console.log("No widgets to add");
    }
    
    // Final check
    console.log("Final DOM elements:", gridContainer?.children.length || 0);
  };

  return (
    <GridModeContext.Provider value={{ isEditMode, setIsEditMode }}>
      <GridContext.Provider value={{ grid, gridRef, getLayout, loadLayout, resetGrid }}>
        {children}
      </GridContext.Provider>
    </GridModeContext.Provider>
  );
};

export default GridProvider;
