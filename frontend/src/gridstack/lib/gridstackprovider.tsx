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
  OCHandoverComponent: { minW: 6, minH: 6 },
  ResourceProfilingComponent: { minW: 6, minH: 6 },
};
const DEFAULT_MIN_SIZE = { minW: 2, minH: 2 };

const getMinSize = (componentName?: string) =>
  (componentName && MIN_SIZES[componentName]) || DEFAULT_MIN_SIZE;

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
        el.innerHTML = '';
        const root = ReactDOM.createRoot(el);
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
        (el as GridWidgetElement)._reactRoot = root;
        (el as GridWidgetElement).gridstackNode = w; // Store node for re-rendering
      } else {
        el.innerHTML = w.content || '';
      }
    };

    if (grid) {
      grid.setStatic(!isEditMode); // Lock grid when not in edit mode
      // Re-render all components with updated isEditMode. Only the grid's own
      // items: the edit-mode palette tiles carry the same class and, once
      // GridStack.setupDragIn has run, a gridstackNode too — passing one of
      // them to grid.update() ends in "Infinite collide check".
      const items = grid.getGridItems();
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
      } else if (component_name === "OCHandoverComponent") {
        props = {
          show_controls: node.show_controls ?? true,
          automatic_loading: node.automatic_loading ?? false,
          method: node.method ?? 'oc',
          resource_types: node.resource_types ?? [],
          businessobject_types: node.businessobject_types ?? [],
          case_type: node.case_type ?? '',
          flat_resource_type: node.flat_resource_type ?? '',
          max_gap: node.max_gap ?? null,
          normalization: node.normalization ?? 'by_arcs_in_eog',
          normalization_scope: node.normalization_scope ?? 'global',
          parallel_filter_enabled: node.parallel_filter_enabled ?? false,
          parallel_threshold: node.parallel_threshold ?? 0.5,
          min_parallel_observations: node.min_parallel_observations ?? 1,
          cluster_by_ot: node.cluster_by_ot ?? false,
          view_mode: node.view_mode ?? 'graph',
        };
      } else if (component_name === "ResourceProfilingComponent") {
        props = {
          show_controls: node.show_controls ?? true,
          automatic_loading: node.automatic_loading ?? false,
          resource_types: node.resource_types ?? [],
          business_object_types: node.business_object_types ?? [],
          feature_groups: node.feature_groups ?? ['activity_fractions'],
          tooltip_feature_groups: node.tooltip_feature_groups ?? [],
          compute_clusters: node.compute_clusters ?? true,
          cluster_method: node.cluster_method ?? 'hdbscan',
          n_clusters: node.n_clusters ?? 3,
          min_cluster_size: node.min_cluster_size ?? 2,
          distance_metric: node.distance_metric ?? 'euclidean',
          view_mode: node.view_mode ?? 'graph',
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
        } else if (item.component_name === "SqlQueryComponent") {
          content = "SQL Editor";
        } else if (item.component_name === "PieChartComponent") {
          content = "Pie Chart";
        } else if (item.component_name === "KpiComponent") {
          content = "KPI (by SQL)";
        } else if (item.component_name === "BarChartComponent") {
          content = "Bar Chart (by SQL)";
        } else if (item.component_name === "ScatterPlotComponent") {
          content = "Scatter Plot (by SQL)";
        } else if (item.component_name === "OCHandoverComponent") {
          content = "Handover of Work";
        } else if (item.component_name === "ResourceProfilingComponent") {
          content = "Resource Profiling";
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
            business_object_types: item.business_object_types,
            business_activities: item.business_activities,
            // LogStatisticsComponent properties
            show_num_events: item.show_num_events,
            show_num_activities: item.show_num_activities,
            show_num_objects: item.show_num_objects,
            show_num_object_types: item.show_num_object_types,
            show_earliest_timestamp: item.show_earliest_timestamp,
            show_newest_timestamp: item.show_newest_timestamp,
            show_duration: item.show_duration,
            // NewOCDFGComponent properties
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
            // SqlQueryComponent properties (`query` is already set above,
            // shared with PieChartComponent)
            name: item.name,
            query_asset: item.query_asset,
            row_limit: item.row_limit,
            // KpiComponent / BarChartComponent / ScatterPlotComponent
            prefix: item.prefix,
            suffix: item.suffix,
            decimals: item.decimals,
            horizontal: item.horizontal,
            show_values: item.show_values,
            x_column: item.x_column,
            y_column: item.y_column,
            series_column: item.series_column,
            x_label: item.x_label,
            y_label: item.y_label,
            // OCHandoverComponent / ResourceProfilingComponent
            method: item.method,
            resource_types: item.resource_types,
            businessobject_types: item.businessobject_types,
            case_type: item.case_type,
            flat_resource_type: item.flat_resource_type,
            max_gap: item.max_gap,
            normalization: item.normalization,
            normalization_scope: item.normalization_scope,
            parallel_filter_enabled: item.parallel_filter_enabled,
            parallel_threshold: item.parallel_threshold,
            min_parallel_observations: item.min_parallel_observations,
            cluster_by_ot: item.cluster_by_ot,
            view_mode: item.view_mode,
            feature_groups: item.feature_groups,
            tooltip_feature_groups: item.tooltip_feature_groups,
            compute_clusters: item.compute_clusters,
            cluster_method: item.cluster_method,
            n_clusters: item.n_clusters,
            min_cluster_size: item.min_cluster_size,
            distance_metric: item.distance_metric,
          });
          // After adding, ensure custom properties are on the node
          if (widgetEl) {
            const node = grid.getGridItems().find(gridItem => gridItem === widgetEl)?.gridstackNode;
            if (node) {
              node.component_name = item.component_name;
              node.component_id = component_id;  // Ensure it's set
              node.text = item.text;
              node.color = item.color; // For NumberOfEventsComponent
              node.font_size = item.font_size;
              node.image = item.image; // For ImageComponent (legacy upload)
              node.image_asset = item.image_asset; // For ImageComponent
              node.image_asset_url = item.image_asset_url; // For ImageComponent
              node.image_fit = item.image_fit; // For ImageComponent
              node.image_alignment = item.image_alignment; // For ImageComponent
              node.automatic_loading = item.automatic_loading; // For VariantsComponent
              node.leading_object_type = item.leading_object_type; // For VariantsComponent
              node.extraction = item.extraction;   // For VariantsComponent advanced settings
              node.iso = item.iso;                 // For VariantsComponent advanced settings
              node.timeout_s = item.timeout_s;     // For VariantsComponent advanced settings
              node.business_object_types = item.business_object_types; // VariantsComponent resource-aware
              node.business_activities = item.business_activities;     // VariantsComponent resource-aware
              // LogStatisticsComponent properties
              node.show_num_events = item.show_num_events;
              node.show_num_activities = item.show_num_activities;
              node.show_num_objects = item.show_num_objects;
              node.show_num_object_types = item.show_num_object_types;
              node.show_earliest_timestamp = item.show_earliest_timestamp;
              node.show_newest_timestamp = item.show_newest_timestamp;
              node.show_duration = item.show_duration;
              // PieChartComponent properties
              node.query = item.query;
              node.ring_text = item.ring_text;
              node.chart_type = item.chart_type;
              node.title = item.title;
              node.label_column = item.label_column;
              node.value_column = item.value_column;
              node.show_legend = item.show_legend;
              node.show_tooltip = item.show_tooltip;
              // NewOCDFGComponent properties
              node.show_controls = item.show_controls;
              node.initial_interaction_locked = item.initial_interaction_locked;
              // OCDottedChartComponent properties
              node.x_axis = item.x_axis;
              node.y_axis = item.y_axis;
              node.color_by = item.color_by;
              node.shape_by = item.shape_by;
              node.row_order = item.row_order;
              node.max_points = item.max_points;
              node.layout_direction = item.layout_direction;
              // OCCNComponent properties
              node.relative_occurrence_threshold = item.relative_occurrence_threshold;
              node.object_types = item.object_types;
              // ProcessAreaComponent properties
              node.algorithm = item.algorithm;
              node.w_temporal = item.w_temporal;
              node.w_cardinality = item.w_cardinality;
              node.w_divergence = item.w_divergence;
              node.alpha = item.alpha;
              node.beta = item.beta;
              // SqlQueryComponent properties
              node.name = item.name;
              node.query = item.query;
              node.query_asset = item.query_asset;
              node.row_limit = item.row_limit;
              // KpiComponent / BarChartComponent / ScatterPlotComponent
              node.prefix = item.prefix;
              node.suffix = item.suffix;
              node.decimals = item.decimals;
              node.horizontal = item.horizontal;
              node.show_values = item.show_values;
              node.x_column = item.x_column;
              node.y_column = item.y_column;
              node.series_column = item.series_column;
              node.x_label = item.x_label;
              node.y_label = item.y_label;
              // OCHandoverComponent / ResourceProfilingComponent
              node.method = item.method;
              node.resource_types = item.resource_types;
              node.businessobject_types = item.businessobject_types;
              node.case_type = item.case_type;
              node.flat_resource_type = item.flat_resource_type;
              node.max_gap = item.max_gap;
              node.normalization = item.normalization;
              node.normalization_scope = item.normalization_scope;
              node.parallel_filter_enabled = item.parallel_filter_enabled;
              node.parallel_threshold = item.parallel_threshold;
              node.min_parallel_observations = item.min_parallel_observations;
              node.cluster_by_ot = item.cluster_by_ot;
              node.view_mode = item.view_mode;
              node.feature_groups = item.feature_groups;
              node.tooltip_feature_groups = item.tooltip_feature_groups;
              node.compute_clusters = item.compute_clusters;
              node.cluster_method = item.cluster_method;
              node.n_clusters = item.n_clusters;
              node.min_cluster_size = item.min_cluster_size;
              node.distance_metric = item.distance_metric;
            }
          }
          // Set data attribute for persistence
          if (widgetEl) {
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
