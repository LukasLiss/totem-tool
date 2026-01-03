import React, {
  createContext,
  useContext,
  useRef,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { GridStack, GridStackNode, GridStackOptions } from "gridstack";

interface GridContextValue {
  grid: GridStack | null;
  gridRef: React.RefObject<HTMLDivElement>;
  addWidget: (content?: string) => void;
  getLayout: () => any[];
  loadLayout: (layout: any[]) => void;
  resetGrid: () => void;
}

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
}) => {
  const gridRef = useRef<GridStack | null>(null);
  const [grid, setGrid] = useState<GridStack | null>(null);

  // Define grid options here so resetGrid can access them
  const gridOptions: GridStackOptions = {
    cellHeight: 70,
    acceptWidgets: true,
    removable: "#trash",
    float: true,
    margin: 5,
    ...(options || {}),
  };

  useEffect(() => {
    // render callback for GridStack - set data attribute for component persistence
    GridStack.renderCB = (el: HTMLElement, w: GridStackNode) => {
      el.innerHTML = w.content || "";
      // Set component name in data attribute from the node
      if (w.component_name) {
        el.dataset.componentName = w.component_name;
      }
    };

    const instance = GridStack.init(gridOptions);

    gridRef.current = instance;
    setGrid(instance);

    return () => instance.destroy(false);
  }, []);

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
      if (component_name === "NumberofEventsComponent") {
        props = { color: "blue" };
      } else if (component_name === "TextBoxComponent") {
        props = { text: node.el ? node.el.innerHTML.trim() || "Enter text here" : "Enter text here", font_size: 14 };
      } else {
        props = { text: node.el ? node.el.innerHTML.trim() : "", font_size: 14 };
      }
      return {
        component_name,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
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
        } else {
          content = "Unknown";
        }
        
        try {
          const widgetEl = gridRef.current?.addWidget({
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
            content,
            component_name: item.component_name, // Store component_name in the node
          });
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
    <GridContext.Provider value={{ grid, gridRef, getLayout, loadLayout, resetGrid }}>
      {children}
    </GridContext.Provider>
  );
};

export default GridProvider;
