import React, {
  useRef,
  useEffect,
  useState,
  ReactNode,
} from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { GridStack, GridStackNode, GridStackOptions, GridStackWidget } from "gridstack";
import { componentMap } from "../../components/componentMapRegistry";
import type { ComponentProps } from "../../components/componentMap";
import type { SelectedFile } from "../../contexts/SelectedFileContext";
import { GridContext, GridModeContext, type GridLayoutItem } from "./gridContext";
import { toast } from "sonner";

type GridWidgetElement = HTMLElement & {
  _reactRoot?: Root;
  gridstackNode?: GridStackNode;
};

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
  OCDottedChartComponent: { minW: 4, minH: 3 },
  NewOCDFGComponent: { minW: 4, minH: 4 },
  NewOCDFGVariantsComponent: { minW: 4, minH: 4 },
  SqlQueryComponent: { minW: 4, minH: 5 },
  PieChartComponent: { minW: 2, minH: 6 },
  KpiComponent: { minW: 2, minH: 2 },
  BarChartComponent: { minW: 3, minH: 3 },
  ScatterPlotComponent: { minW: 3, minH: 3 },
};
const DEFAULT_MIN_SIZE = { minW: 2, minH: 2 };

const getMinSize = (componentName?: string) =>
  (componentName && MIN_SIZES[componentName]) || DEFAULT_MIN_SIZE;

const COMPONENT_TITLES: Record<string, string> = {
  NumberofEventsComponent: "Number of Events",
  TextBoxComponent: "Text Box",
  ImageComponent: "Image Component",
  VariantsComponent: "Variants Explorer",
  ProcessAreaComponent: "Process Area",
  TotemMinerComponent: "TOTeM Miner",
  LogStatisticsComponent: "Log Statistics",
  OCDottedChartComponent: "OC Dotted Chart",
  NewOCDFGComponent: "Object-Centric DFG (Arc Weight)",
  NewOCDFGVariantsComponent: "Object-Centric DFG (Variants)",
  OCPNComponent: "OC Petri Net",
  OCCNComponent: "Object-Centric Causal Net (OCCN)",
  SqlQueryComponent: "SQL Editor",
  PieChartComponent: "Pie Chart",
  KpiComponent: "KPI (by SQL)",
  BarChartComponent: "Bar Chart (by SQL)",
  ScatterPlotComponent: "Scatter Plot (by SQL)",
};

interface GridProviderProps {
  children: ReactNode;
  options?: GridStackOptions;
  selectedFile?: SelectedFile | null;
  dashboardId?: number;
}

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
    // Update renderCB with current isEditMode
    GridStack.renderCB = (el: HTMLElement, w: GridStackNode) => {
      const component_name = w.component_name || el.dataset.componentName;
      const Component = componentMap[component_name];

      if (Component) {
        let root = (el as GridWidgetElement)._reactRoot;
        if (!root) {
          el.innerHTML = '';
          root = ReactDOM.createRoot(el);
          (el as GridWidgetElement)._reactRoot = root;
        }
        root.render(
          <Component
            node={w as ComponentProps['node']}
            isEditMode={isEditMode}
            selectedFile={selectedFile}
            dashboardId={dashboardId}  // Pass dashboardId
            onUpdate={(updates) => {
              Object.assign(w, updates);
              gridRef.current?.update(el, updates);
            }}
          />
        );
        (el as GridWidgetElement).gridstackNode = w; // Store node for re-rendering
      } else {
        el.innerHTML = w.content || '';
      }
    };

    if (grid) {
      grid.setStatic(!isEditMode); // Lock grid when not in edit mode
      // Re-render all components with updated isEditMode
      const items = document.querySelectorAll('.grid-stack-item');
      items.forEach((item) => {
        const contentEl = (item.querySelector('.grid-stack-item-content') || item) as HTMLElement;
        const root = (contentEl as GridWidgetElement)._reactRoot;
        const node = (contentEl as GridWidgetElement).gridstackNode;
        const component_name = node?.component_name || contentEl.dataset.componentName || (item as HTMLElement).dataset.componentName;
        // Self-heal widgets whose node predates the min-size feature (e.g. loaded
        // from an older saved layout) — grows them up to the minimum if needed.
        if (node) {
          const { minW, minH } = getMinSize(component_name);
          gridRef.current?.update(item as HTMLElement, { minW, minH });
        }
        const Component = componentMap[component_name];
        if (root && Component && node) {
          root.render(
            <Component
              node={node as ComponentProps['node']}
              isEditMode={isEditMode}
              selectedFile={selectedFile}
              dashboardId={dashboardId}
              onUpdate={(updates) => {
                Object.assign(node, updates);
                gridRef.current?.update(item as HTMLElement, updates);
              }}
            />
          );
        }
      });
    }
  }, [isEditMode, grid, selectedFile, dashboardId]);

  // Implement addWidget to add new widgets with generated component_id
  const addWidget = (content: string = "", componentName: string = "TextBoxComponent") => {
  // `grid` state lags a render behind the mount effect that creates the
  // instance, while gridRef is set synchronously. Shadowing it with the ref
  // keeps these callbacks off a null instance — the cause of the
  // "Cannot read properties of null (reading 'getGridItems')" errors that
  // fired on every dashboard load.
    const grid = gridRef.current;
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
        node.component_name = componentName;
        node.component_id = newId;
      }
      widgetEl.dataset.componentName = componentName;
    }
  };

  const resetGrid = () => {
    const grid = gridRef.current;
    try {
      // Clear all widgets and reset the grid state without destroying
      if (grid) {
        grid.removeAll(true);
        
        // Clear the DOM manually to ensure clean state
        if (grid.el) {
          grid.el.innerHTML = '';
        }
      }
    } catch {
      // Reset failed — rebuild the instance from scratch.
      try {
        if (gridRef.current) {
          grid.el.innerHTML = '';
          const newGrid = GridStack.init(gridOptions, grid.el);
          gridRef.current = newGrid;
          setGrid(newGrid);
        }
      } catch {
        // Nothing left to try; the grid stays as it is.
      }
    }
  };

  const getLayout = () => {
    if (!gridRef.current) return [];
    const nodes = gridRef.current.save(false) as GridStackNode[];
    return nodes.map((node, index) => {
      // Ensure component_id is set (generate if missing)
      const component_id = node.component_id || generateComponentId();
      node.component_id = component_id;  // Update node for consistency
      // Use component_name from the node, fallback to data attribute or content-based logic
      const component_name = node.component_name || node.el?.dataset.componentName || "TextBoxComponent";
      let props: Partial<GridStackWidget> = {};
      const w =
        node.w ??
        1; // necessary because GS sets w=1 to undefined
      const h =
        node.h ??
        1; // necessary because GS sets h=1 to undefined
      if (component_name === "NumberofEventsComponent") {
        props = { color: "blue" };
      } else if (component_name === "TextBoxComponent") {
        props = { text: node.text || "Enter text here", font_size: 14 };  
      } else if (component_name === "ImageComponent") {
        props = {
          image: node.image,
          image_asset: node.image_asset ?? null,
          image_fit: node.image_fit ?? "contain",
          image_alignment: node.image_alignment ?? "center",
        };
      } else if (component_name === "VariantsComponent") {
        props = {
          automatic_loading: node.automatic_loading ?? false,
          leading_object_type: node.leading_object_type ?? '',
          // Persisted advanced settings — see VariantsExplorer.tsx for semantics.
          extraction: node.extraction ?? 'leading_1hop',
          iso: node.iso ?? 'wl+vf2',
          timeout_s: node.timeout_s ?? 10.0,
          business_object_types: node.business_object_types ?? [],
          business_activities: node.business_activities ?? [],
        };
      } else if (component_name === "LogStatisticsComponent") {
        props = {
          show_num_events: node.show_num_events ?? true,
          show_num_activities: node.show_num_activities ?? true,
          show_num_objects: node.show_num_objects ?? true,
          show_num_object_types: node.show_num_object_types ?? true,
          show_earliest_timestamp: node.show_earliest_timestamp ?? false,
          show_newest_timestamp: node.show_newest_timestamp ?? false,
          show_duration: node.show_duration ?? false,
        };
      } else if (component_name === "OCDottedChartComponent") {
        props = {
          x_axis: node.x_axis ?? "time",
          y_axis: node.y_axis ?? "activity",
          color_by: node.color_by ?? "activity",
          shape_by: node.shape_by ?? "none",
          row_order: node.row_order ?? "first_occurrence",
          max_points: node.max_points ?? 10000,
        };
      } else if (component_name === "NewOCDFGComponent" || component_name === "NewOCDFGVariantsComponent") {
        props = {
          show_controls: node.show_controls ?? true,
          initial_interaction_locked: node.initial_interaction_locked ?? true,
          layout_direction: node.layout_direction ?? 'TB',
        };
      } else if (component_name === "ProcessAreaComponent") {
        props = {
          algorithm: node.algorithm ?? "advanced",
          w_temporal: node.w_temporal ?? 1,
          w_cardinality: node.w_cardinality ?? 1,
          w_divergence: node.w_divergence ?? 1,
          alpha: node.alpha ?? 1,
          beta: node.beta ?? 1,
        };
      } else if (component_name === "OCCNComponent") {
        props = {
          relative_occurrence_threshold: node.relative_occurrence_threshold ?? 0,
          object_types: node.object_types ?? "",
          show_controls: node.show_controls ?? true,
          initial_interaction_locked: node.initial_interaction_locked ?? true,
          layout_direction: node.layout_direction ?? 'LR',
        };
      } else if (component_name === "OCPNComponent") {
        props = {
          automatic_loading: node.automatic_loading ?? false,
          timeout_s: node.timeout_s ?? 30.0,
        };
      } else if (component_name === "SqlQueryComponent") {
        props = {
          name: node.name ?? "",
          query: node.query ?? "SELECT activity, count(*) AS n FROM events GROUP BY activity",
          query_asset: node.query_asset ?? null,
          row_limit: node.row_limit ?? 25,
        };
      } else if (component_name === "KpiComponent") {
        props = {
          title: node.title ?? "",
          query: node.query ?? "",
          query_asset: node.query_asset ?? null,
          value_column: node.value_column ?? "",
          prefix: node.prefix ?? "",
          suffix: node.suffix ?? "",
          decimals: node.decimals ?? 0,
        };
      } else if (component_name === "BarChartComponent") {
        props = {
          title: node.title ?? "",
          query: node.query ?? "",
          query_asset: node.query_asset ?? null,
          label_column: node.label_column ?? "",
          value_column: node.value_column ?? "",
          horizontal: node.horizontal ?? false,
          show_values: node.show_values ?? false,
        };
      } else if (component_name === "ScatterPlotComponent") {
        props = {
          title: node.title ?? "",
          query: node.query ?? "",
          query_asset: node.query_asset ?? null,
          x_column: node.x_column ?? "",
          y_column: node.y_column ?? "",
          series_column: node.series_column ?? "",
          x_label: node.x_label ?? "",
          y_label: node.y_label ?? "",
        };
      } else if (component_name === "PieChartComponent") {
        props = {
          query: node.query ?? '',
          query_asset: node.query_asset ?? null,
          ring_text: node.ring_text ?? '',
          chart_type: node.chart_type ?? 'donut',
          title: node.title ?? '',
          label_column: node.label_column ?? '',
          value_column: node.value_column ?? '',
          show_legend: node.show_legend ?? true,
          show_tooltip: node.show_tooltip ?? true,
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
        id: component_id,  // Now always set — spread last so this always wins
      };
    });
  };

  const loadLayout = (layout: GridLayoutItem[]) => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    if (!Array.isArray(layout)) {
      // Nothing loadable — leave an empty grid rather than a half-built one.
      try {
        grid.removeAll(false);
      } catch {
        resetGrid();
      }
      return;
    }
    
    try {
      grid.removeAll(true);
    } catch {
      resetGrid();
      // After reset, try again
      try {
        grid.removeAll(true);
      } catch {
        return;
      }
    }
    
    if (layout.length > 0) {
      layout.forEach((item) => {
        const content = (item.component_name && COMPONENT_TITLES[item.component_name]) || "Unknown";

        // Ensure component_id is set (generate if missing from layout)
        const component_id = item.id || item.component_id || generateComponentId();
        const { minW, minH } = getMinSize(item.component_name);
        const restItem = { ...item };
        delete restItem.id;

        try {
          const widgetEl = gridRef.current?.addWidget({
            ...restItem,
            id: item.id !== undefined ? String(item.id) : undefined,
            w: Math.max(item.w ?? 0, minW),
            h: Math.max(item.h ?? 0, minH),
            minW,
            minH,
            content,  // Keep for GridStack compatibility
            component_id,  // Now always set
          });
          // After adding, ensure custom properties are on the node
          if (widgetEl) {
            const node = grid.getGridItems().find(gridItem => gridItem === widgetEl)?.gridstackNode;
            if (node) {
              Object.assign(node, item, { component_id });
            }
            widgetEl.dataset.componentName = item.component_name;
          }
        } catch {
          // One widget the grid refuses must not take the rest down with it.
          toast.error("A dashboard component could not be placed");
        }
      });
    }
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
