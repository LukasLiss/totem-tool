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

// Minimum grid cell size (w, h) per component type. Falls back to DEFAULT_MIN_SIZE
// for any component_name not listed here. Enforced by GridStack itself, so users
// cannot drag/resize a widget smaller than this.
const MIN_SIZES: Record<string, { minW: number; minH: number }> = {
  TextBoxComponent: { minW: 2, minH: 2 },
  NumberOfEventsComponent: { minW: 2, minH: 2 },
  ImageComponent: { minW: 2, minH: 2 },
  VariantsComponent: { minW: 4, minH: 4 },
  ProcessAreaComponent: { minW: 4, minH: 4 },
  LogStatisticsComponent: { minW: 3, minH: 2 },
  OCDFGComponent: { minW: 4, minH: 4 },
  OCDottedChartComponent: { minW: 4, minH: 3 },
  NewOCDFGComponent: { minW: 4, minH: 4 },
  NewOCDFGVariantsComponent: { minW: 4, minH: 4 },
  SQLQueryComponent: { minW: 3, minH: 3 },
  PieChartComponent: { minW: 2, minH: 6 },
};
const DEFAULT_MIN_SIZE = { minW: 2, minH: 2 };

const getMinSize = (componentName?: string) =>
  (componentName && MIN_SIZES[componentName]) || DEFAULT_MIN_SIZE;

interface GridContextValue {
  grid: GridStack | null;
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
  dashboardId?: number;
}

export const useGridMode = () => useContext(GridModeContext);

const GridContext = createContext<GridContextValue | undefined>(undefined);

export const useGrid = () => {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("useGrid must be used inside GridProvider");
  return ctx;
};

export const GridProvider: React.FC<GridProviderProps> = ({
  children,
  options,
  selectedFile,
  dashboardId = 0,
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

  useEffect(() => {
    // Initialize GridStack without renderCB (set later)
    const instance = GridStack.init(gridOptions);
    gridRef.current = instance;
    setGrid(instance);

    return () => {
      instance.destroy(false);
    };
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
            node={w as any}
            isEditMode={isEditMode}
            selectedFile={selectedFile}
            dashboardId={dashboardId}  // Pass dashboardId
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
        const contentEl = (item.querySelector('.grid-stack-item-content') || item) as HTMLElement;
        const root = (contentEl as any)._reactRoot;
        const node = (contentEl as any).gridstackNode;
        const component_name = (node as any)?.component_name || contentEl.dataset.componentName || (item as HTMLElement).dataset.componentName;
        console.log(`Item ${index} - component_name: ${component_name}, node:`, node);
        // Self-heal widgets whose node predates the min-size feature (e.g. loaded
        // from an older saved layout) — grows them up to the minimum if needed.
        if (node) {
          const { minW, minH } = getMinSize(component_name);
          gridRef.current?.update(item as HTMLElement, { minW, minH });
        }
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
    const { minW, minH } = getMinSize(componentName);
    const widgetEl = grid.addWidget({
      x: 0,
      y: 0,
      w: Math.max(2, minW),
      h: Math.max(2, minH),
      minW,
      minH,
      content,
      component_name: componentName,
      component_id: newId,
    });
    if (widgetEl) {
      const node = grid.getGridItems().find(item => item === widgetEl)?.gridstackNode;
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
          grid.el.innerHTML = '';
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
          grid.el.innerHTML = '';
          const newGrid = GridStack.init(gridOptions, grid.el);
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
        props = {
          image: (node as any).image,
          image_asset: (node as any).image_asset ?? null,
          image_fit: (node as any).image_fit ?? "contain",
          image_alignment: (node as any).image_alignment ?? "center",
        };
      } else if (component_name === "VariantsComponent") {
        props = {
          automatic_loading: (node as any).automatic_loading ?? false,
          leading_object_type: (node as any).leading_object_type ?? '',
          // Persisted advanced settings — see VariantsExplorer.tsx for semantics.
          extraction: (node as any).extraction ?? 'leading_1hop',
          iso: (node as any).iso ?? 'wl+vf2',
          timeout_s: (node as any).timeout_s ?? 10.0,
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
      } else if (component_name === "OCDottedChartComponent") {
        props = {
          x_axis: (node as any).x_axis ?? "time",
          y_axis: (node as any).y_axis ?? "activity",
          color_by: (node as any).color_by ?? "activity",
          shape_by: (node as any).shape_by ?? "none",
          row_order: (node as any).row_order ?? "first_occurrence",
          max_points: (node as any).max_points ?? 10000,
        };
      } else if (component_name === "NewOCDFGComponent" || component_name === "NewOCDFGVariantsComponent") {
        props = {
          show_controls: (node as any).show_controls ?? true,
          initial_interaction_locked: (node as any).initial_interaction_locked ?? true,
          layout_direction: (node as any).layout_direction ?? 'TB',
        };
      } else if (component_name === "ProcessAreaComponent") {
        props = {
          algorithm: (node as any).algorithm ?? "advanced",
          w_temporal: (node as any).w_temporal ?? 1,
          w_cardinality: (node as any).w_cardinality ?? 1,
          w_divergence: (node as any).w_divergence ?? 1,
          alpha: (node as any).alpha ?? 1,
          beta: (node as any).beta ?? 1,
        };
      } else if (component_name === "OCCNComponent") {
        props = {
          relative_occurrence_threshold: (node as any).relative_occurrence_threshold ?? 0,
          object_types: (node as any).object_types ?? "",
          show_controls: (node as any).show_controls ?? true,
          initial_interaction_locked: (node as any).initial_interaction_locked ?? true,
          layout_direction: (node as any).layout_direction ?? 'LR',
        };
      } else if (component_name === "OCPNComponent") {
        props = {
          automatic_loading: (node as any).automatic_loading ?? false,
          timeout_s: (node as any).timeout_s ?? 30.0,
        };
      } else if (component_name === "PieChartComponent") {
        props = {
          query: (node as any).query ?? '',
          ring_text: (node as any).ring_text ?? '',
          chart_type: (node as any).chart_type ?? 'donut',
          title: (node as any).title ?? '',
          label_column: (node as any).label_column ?? '',
          value_column: (node as any).value_column ?? '',
          show_legend: (node as any).show_legend ?? true,
          show_tooltip: (node as any).show_tooltip ?? true,
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
      grid.removeAll(true);
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
        } else if (item.component_name === "TotemMinerComponent") {
          content = "TOTeM Miner";
        } else if (item.component_name === "LogStatisticsComponent") {
          content = "Log Statistics";
        } else if (item.component_name === "OCDFGComponent") {
          content = "OCDFG";
        } else if (item.component_name === "OCDottedChartComponent") {
          content = "OC Dotted Chart";
        } else if (item.component_name === "NewOCDFGComponent") {
          content = "Object-Centric DFG (Arc Weight)";
        } else if (item.component_name === "NewOCDFGVariantsComponent") {
          content = "Object-Centric DFG (Variants)";
        } else if (item.component_name === "OCPNComponent") {
          content = "OC Petri Net";
        } else if (item.component_name === "OCCNComponent") {
          content = "Object-Centric Causal Net (OCCN)";
        } else if (item.component_name === "PieChartComponent") {
          content = "Pie Chart";
        } else {
          content = "Unknown";
        }
        
        // Ensure component_id is set (generate if missing from layout)
        const component_id = item.id || item.component_id || generateComponentId();
        const { minW, minH } = getMinSize(item.component_name);

        try {
          const widgetEl = gridRef.current?.addWidget({
            x: item.x,
            y: item.y,
            w: Math.max(item.w, minW),
            h: Math.max(item.h, minH),
            minW,
            minH,
            content,  // Keep for GridStack compatibility
            text: item.text,
            component_name: item.component_name,
            component_id,  // Now always set
            color: item.color,
            font_size: item.font_size,
            image: item.image,
            // ImageComponent (asset-store based) properties
            image_asset: item.image_asset,
            image_asset_url: item.image_asset_url,
            image_fit: item.image_fit,
            image_alignment: item.image_alignment,
            automatic_loading: item.automatic_loading,
            leading_object_type: item.leading_object_type,
            // VariantsComponent — persisted advanced settings
            extraction: item.extraction,
            iso: item.iso,
            timeout_s: item.timeout_s,
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
            // OCDottedChartComponent properties
            x_axis: item.x_axis,
            y_axis: item.y_axis,
            color_by: item.color_by,
            shape_by: item.shape_by,
            row_order: item.row_order,
            max_points: item.max_points,
            layout_direction: item.layout_direction,
            // PieChartComponent properties
            query: item.query,
            ring_text: item.ring_text,
            chart_type: item.chart_type,
            title: item.title,
            label_column: item.label_column,
            value_column: item.value_column,
            show_legend: item.show_legend,
            show_tooltip: item.show_tooltip,
            // OCCNComponent properties
            relative_occurrence_threshold: item.relative_occurrence_threshold,
            object_types: item.object_types,
            // ProcessAreaComponent properties
            algorithm: item.algorithm,
            w_temporal: item.w_temporal,
            w_cardinality: item.w_cardinality,
            w_divergence: item.w_divergence,
            alpha: item.alpha,
            beta: item.beta,
          });
          // After adding, ensure custom properties are on the node
          if (widgetEl) {
            const node = grid.getGridItems().find(gridItem => gridItem === widgetEl)?.gridstackNode;
            if (node) {
              (node as any).component_name = item.component_name;
              (node as any).component_id = component_id;  // Ensure it's set
              (node as any).text = item.text;
              (node as any).color = item.color; // For NumberOfEventsComponent
              (node as any).font_size = item.font_size;
              (node as any).image = item.image; // For ImageComponent (legacy upload)
              (node as any).image_asset = item.image_asset; // For ImageComponent
              (node as any).image_asset_url = item.image_asset_url; // For ImageComponent
              (node as any).image_fit = item.image_fit; // For ImageComponent
              (node as any).image_alignment = item.image_alignment; // For ImageComponent
              (node as any).automatic_loading = item.automatic_loading; // For VariantsComponent
              (node as any).leading_object_type = item.leading_object_type; // For VariantsComponent
              (node as any).extraction = item.extraction;   // For VariantsComponent advanced settings
              (node as any).iso = item.iso;                 // For VariantsComponent advanced settings
              (node as any).timeout_s = item.timeout_s;     // For VariantsComponent advanced settings
              // LogStatisticsComponent properties
              (node as any).show_num_events = item.show_num_events;
              (node as any).show_num_activities = item.show_num_activities;
              (node as any).show_num_objects = item.show_num_objects;
              (node as any).show_num_object_types = item.show_num_object_types;
              (node as any).show_earliest_timestamp = item.show_earliest_timestamp;
              (node as any).show_newest_timestamp = item.show_newest_timestamp;
              (node as any).show_duration = item.show_duration;
              // OCDFGComponent properties
              // PieChartComponent properties
              (node as any).query = item.query;
              (node as any).ring_text = item.ring_text;
              (node as any).chart_type = item.chart_type;
              (node as any).title = item.title;
              (node as any).label_column = item.label_column;
              (node as any).value_column = item.value_column;
              (node as any).show_legend = item.show_legend;
              (node as any).show_tooltip = item.show_tooltip;
              (node as any).show_controls = item.show_controls;
              (node as any).initial_interaction_locked = item.initial_interaction_locked;
              // OCDottedChartComponent properties
              (node as any).x_axis = item.x_axis;
              (node as any).y_axis = item.y_axis;
              (node as any).color_by = item.color_by;
              (node as any).shape_by = item.shape_by;
              (node as any).row_order = item.row_order;
              (node as any).max_points = item.max_points;
              (node as any).layout_direction = item.layout_direction;
              // OCCNComponent properties
              (node as any).relative_occurrence_threshold = item.relative_occurrence_threshold;
              (node as any).object_types = item.object_types;
              // ProcessAreaComponent properties
              (node as any).algorithm = item.algorithm;
              (node as any).w_temporal = item.w_temporal;
              (node as any).w_cardinality = item.w_cardinality;
              (node as any).w_divergence = item.w_divergence;
              (node as any).alpha = item.alpha;
              (node as any).beta = item.beta;
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
      <GridContext.Provider value={{ grid, addWidget, getLayout, loadLayout, resetGrid }}>
        {children}
      </GridContext.Provider>
    </GridModeContext.Provider>
  );
};

export default GridProvider;
