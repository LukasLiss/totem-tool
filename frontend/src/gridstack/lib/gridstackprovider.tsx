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
  gridRef: React.RefObject<GridStack | null>;
  addWidget: (content?: string, componentName?: string) => void;  // Updated to include componentName
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
  selectedFile?: any;  // Made optional
  dashboardId: number;  // Added
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
  dashboardId,
}) => {
  const gridRef = useRef<GridStack | null>(null);
  const [grid, setGrid] = useState<GridStack | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const componentIdCounter = useRef(1);  // Counter for generating unique component IDs

  // Define grid options here so resetGrid can access them
  const gridOptions: GridStackOptions = {
    cellHeight: 70,
    acceptWidgets: true,
    removable: "#trash",
    float: true,
    ...(options || {}),
  };

  // Function to generate a unique component ID
  const generateComponentId = () => {
    return componentIdCounter.current++;
  };

  const renderGridComponent = (el: HTMLElement, w: GridStackNode) => {
    const component_name = (w as any).component_name || el.dataset.componentName;
    const Component = componentMap[component_name];
    const node = w as any;

    // Preserve custom props via DOM dataset when gridstack does not retain them on the node
    if (node.query == null && el.dataset.query) node.query = el.dataset.query;
    if (node.ring_text == null && el.dataset.ringText) node.ring_text = el.dataset.ringText;
    if (node.chart_type == null && el.dataset.chartType) node.chart_type = el.dataset.chartType as any;
    if (node.title == null && el.dataset.title) node.title = el.dataset.title;
    if (node.show_legend == null && el.dataset.showLegend) node.show_legend = el.dataset.showLegend === 'true';
    if (node.show_tooltip == null && el.dataset.showTooltip) node.show_tooltip = el.dataset.showTooltip === 'true';
    if (node.label_column == null && el.dataset.labelColumn) node.label_column = el.dataset.labelColumn;
    if (node.value_column == null && el.dataset.valueColumn) node.value_column = el.dataset.valueColumn;

    if (Component) {
      if (component_name === "PieChartComponent") {
        console.log("Rendering PieChartComponent with node props:", {
          query: node.query,
          label_column: node.label_column,
          value_column: node.value_column,
          chart_type: node.chart_type,
          title: node.title,
          ring_text: node.ring_text,
          show_legend: node.show_legend,
          show_tooltip: node.show_tooltip,
          dataset: el.dataset,
        });
      }
      el.innerHTML = '';
      const root = ReactDOM.createRoot(el);
      root.render(
        <Component
          node={node}
          isEditMode={isEditMode}
          selectedFile={selectedFile}
          dashboardId={dashboardId}
          onUpdate={(updates) => {
            Object.assign(node, updates);
            gridRef.current?.update(el, updates);
          }}
        />
      );
      (el as any)._reactRoot = root;
      (el as any).gridstackNode = node; // Store node for re-rendering
    } else {
      el.innerHTML = (node as any).content || '';
    }
  };

  useEffect(() => {
    // Initialize GridStack with renderCB set immediately
    GridStack.renderCB = renderGridComponent;
    const instance = GridStack.init({ ...gridOptions, renderCB: renderGridComponent } as any);
    gridRef.current = instance;
    setGrid(instance);

    return () => {
      instance.destroy(false);
    };
  }, []); // Empty dependency: run once on mount

  // Separate effect for updating grid static state when edit mode changes
  useEffect(() => {
    console.log('GridProvider useEffect - isEditMode changed to:', isEditMode);
    GridStack.renderCB = renderGridComponent;

    if (grid) {
      grid.setStatic(!isEditMode); // Lock grid when not in edit mode
      console.log('Grid setStatic called with:', !isEditMode);
      // Re-render all components with updated isEditMode
      const items = document.querySelectorAll('.grid-stack-item');
      console.log('Found grid items to re-render:', items.length);
      items.forEach((item, index) => {
        const itemEl = item as HTMLElement;
        console.log(`Re-rendering item ${index}`);
        const root = (itemEl as any)._reactRoot;
        const node = (itemEl as any).gridstackNode;
        const component_name = (node as any)?.component_name || itemEl.dataset.componentName;
        console.log(`Item ${index} - component_name: ${component_name}, node:`, node);
        const Component = componentMap[component_name];
        if (root && Component && node) {
          console.log(`Re-rendering component for item ${index}`);
          root.render(
            <Component
              node={node}
              isEditMode={isEditMode}
              selectedFile={selectedFile}
              dashboardId={dashboardId}
              onUpdate={(updates) => {
                Object.assign(node, updates);
                gridRef.current?.update(item as HTMLElement, updates);
              }}
            />
          );
        } else if (Component && node) {
          console.log(`Creating missing root for item ${index}`);
          renderGridComponent(item as HTMLElement, node);
        } else {
          console.log(`Skipping re-render for item ${index} - missing root, Component, or node`);
        }
      });
    } else {
      console.log('No grid instance to update');
    }
  }, [isEditMode, grid, selectedFile, dashboardId]);

  // Implement addWidget to add new widgets with generated component_id
  const addWidget = (content: string = "", componentName: string = "TextBoxComponent") => {
    if (!grid) return;
    const newId = generateComponentId();
    const widgetEl = grid.addWidget({
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      content,
      component_name: componentName,
      component_id: newId,
    } as any);
    if (widgetEl) {
      const node = (grid.getGridItems() as any[]).find((item: any) => item.el === widgetEl)?.gridstackNode;
      if (node) {
        (node as any).component_name = componentName;
        (node as any).component_id = newId;
      }
      widgetEl.dataset.componentName = componentName;
    }
  };

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
          ((gridRef.current as any).el as HTMLElement).innerHTML = '';
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
          (gridRef.current as any).el.innerHTML = '';
          const newGrid = GridStack.init(gridOptions as any, (gridRef.current as any).el);
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
      // Ensure component_id is set (generate if missing)
      let component_id = (node as any).component_id || generateComponentId();
      (node as any).component_id = component_id;  // Update node for consistency
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
        props = { text: (node as any).text || "Enter text here", font_size: 14 };  
      } else if (component_name === "ImageComponent") {
        props = { image: (node as any).image};
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
      } else if (component_name === "SQLQueryComponent") {
        props = {
          query: (node as any).query || node.el?.dataset.query || "",
        };
      } else if (component_name === "PieChartComponent") {
        props = {
          query: (node as any).query || node.el?.dataset.query || "",
          ring_text: (node as any).ring_text || node.el?.dataset.ringText || "",
          chart_type: (node as any).chart_type || (node.el?.dataset.chartType as any) || "donut",
          title: (node as any).title || node.el?.dataset.title || "",
          show_legend: (node as any).show_legend ?? (node.el?.dataset.showLegend === 'false' ? false : true),
          show_tooltip: (node as any).show_tooltip ?? (node.el?.dataset.showTooltip === 'false' ? false : true),
          label_column: (node as any).label_column || node.el?.dataset.labelColumn || "",
          value_column: (node as any).value_column || node.el?.dataset.valueColumn || "",
        };
      } else {
        props = { text: node.el ? node.el.innerHTML.trim() : "", font_size: 14 };
      }
      
      return {
        id: component_id,  // Now always set
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
        if (item.component_name === "NumberofEventsComponent") {
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
        } else if (item.component_name === "SQLQueryComponent") {
          content = "SQL Component";
        }  else if (item.component_name === "PieChartComponent") {
          content = "Piechart Component";
          }
          else {
          content = "Unknown";
        }
        
        // Ensure component_id is set (generate if missing from layout)
        const component_id = item.id || item.component_id || generateComponentId();
        
        try {
          const widgetEl = gridRef.current?.addWidget({
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
            content,  // Keep for GridStack compatibility
            text: (item as any).text,
            component_name: (item as any).component_name,
            component_id,  // Now always set
            color: (item as any).color,
            font_size: (item as any).font_size,
            image: (item as any).image,
            automatic_loading: (item as any).automatic_loading,
            leading_object_type: (item as any).leading_object_type,
            // OCELQueryComponent properties
            query: item.query,
            // PieChartComponent properties
            ring_text: item.ring_text,
            chart_type: item.chart_type,
            title: item.title,
            show_legend: item.show_legend,
            show_tooltip: item.show_tooltip,
            label_column: item.label_column,
            value_column: item.value_column,
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
          } as any);
          const node = widgetEl
            ? (gridRef.current?.getGridItems() as any[]).find((gridItem: any) => gridItem.el === widgetEl)?.gridstackNode
            : undefined;
          // After adding, ensure custom properties are on the node
          if (node) {
            (node as any).component_name = item.component_name;
            (node as any).component_id = component_id;  // Ensure it's set
            (node as any).text = item.text;
            (node as any).color = item.color; // For NumberOfEventsComponent
            (node as any).font_size = item.font_size;
            (node as any).image = item.image; // For ImageComponent
            (node as any).automatic_loading = item.automatic_loading; // For VariantsComponent
            (node as any).leading_object_type = item.leading_object_type; // For VariantsComponent
            (node as any).query = item.query; // For SQLQueryComponent and PieChartComponent
            // PieChartComponent properties
            (node as any).ring_text = item.ring_text;
            (node as any).chart_type = item.chart_type;
            (node as any).title = item.title;
            (node as any).show_legend = item.show_legend;
            (node as any).show_tooltip = item.show_tooltip;
            (node as any).label_column = item.label_column;
            (node as any).value_column = item.value_column;
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
          }
          // Set data attribute for persistence and fallback
          if (widgetEl) {
            widgetEl.dataset.componentName = item.component_name;
            widgetEl.dataset.query = item.query || '';
            widgetEl.dataset.ringText = item.ring_text || '';
            widgetEl.dataset.chartType = item.chart_type || 'donut';
            widgetEl.dataset.title = item.title || '';
            widgetEl.dataset.showLegend = String(item.show_legend ?? true);
            widgetEl.dataset.showTooltip = String(item.show_tooltip ?? true);
            widgetEl.dataset.labelColumn = item.label_column || '';
            widgetEl.dataset.valueColumn = item.value_column || '';
          }

          if (widgetEl && node) {
            renderGridComponent(widgetEl, node);
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
      <GridContext.Provider value={{ grid, gridRef, addWidget, getLayout, loadLayout, resetGrid }}>
        {children}
      </GridContext.Provider>
    </GridModeContext.Provider>
  );
};

export default GridProvider;