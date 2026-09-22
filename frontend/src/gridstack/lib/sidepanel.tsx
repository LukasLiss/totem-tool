import React, { useEffect } from "react";
import { GridStack } from "gridstack";
import { useGrid } from "./gridContext";
import {
  BarChartTile,
  DottedChartTile,
  ImageTile,
  KpiTile,
  LogStatisticsTile,
  OccnTile,
  OcdfgArcWeightTile,
  OcdfgVariantsTile,
  OcpnTile,
  PieChartTile,
  ProcessAreaTile,
  ScatterPlotTile,
  SqlEditorTile,
  TextBoxTile,
  TotemMinerTile,
  TrashTile,
  VariantsTile,
} from "@/components/tiles/tile-previews";

const SidePanel: React.FC = () => {
  const { grid } = useGrid();

  useEffect(() => {
    if (!grid) return;

    GridStack.setupDragIn(
      ".sidepanel .text-box",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 1, w: 6, content: "Text Box", component_name: "TextBoxComponent", font_size: 14, text: "", order: 0 }]  // Ensure consistency
    );

    GridStack.setupDragIn(
      ".sidepanel .image-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 2, w: 2, content: "Image Component", component_name: "ImageComponent", font_size: 14, text: "", order: 0 }]  // Ensure consistency
    );

    GridStack.setupDragIn(
      ".sidepanel .variants-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 4, w: 6, content: "Variants Explorer", component_name: "VariantsComponent", automatic_loading: false, leading_object_type: '', business_object_types: [], business_activities: [], order: 0 }]
    );

    GridStack.setupDragIn(
      ".sidepanel .process-area-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 6, w: 8, content: "Process Area", component_name: "ProcessAreaComponent", order: 0 }]
    );

    GridStack.setupDragIn(
      ".sidepanel .totem-miner-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 6, w: 8, content: "TOTeM Miner", component_name: "TotemMinerComponent", order: 0 }]
    );

    GridStack.setupDragIn(
      ".sidepanel .log-statistics-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 2,
        w: 4,
        content: "Log Statistics",
        component_name: "LogStatisticsComponent",
        show_num_events: true,
        show_num_activities: true,
        show_num_objects: true,
        show_num_object_types: true,
        show_earliest_timestamp: false,
        show_newest_timestamp: false,
        show_duration: false,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .oc-dotted-chart-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 7,
        w: 10,
        content: "OC Dotted Chart",
        component_name: "OCDottedChartComponent",
        x_axis: "time",
        y_axis: "activity",
        color_by: "activity",
        shape_by: "none",
        row_order: "first_occurrence",
        max_points: 10000,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .new-ocdfg-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 6,
        w: 8,
        content: "Object-Centric DFG (Arc Weight)",
        component_name: "NewOCDFGComponent",
        show_controls: true,
        initial_interaction_locked: true,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .new-ocdfg-variants-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 6,
        w: 8,
        content: "Object-Centric DFG (Variants)",
        component_name: "NewOCDFGVariantsComponent",
        show_controls: true,
        initial_interaction_locked: true,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .occn-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 6,
        w: 8,
        content: "Object-Centric Causal Net (OCCN)",
        component_name: "OCCNComponent",
        relative_occurrence_threshold: 0,
        object_types: "",
        show_controls: true,
        initial_interaction_locked: true,
        layout_direction: "LR",
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .ocpn-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 6,
        w: 8,
        content: "OC Petri Net",
        component_name: "OCPNComponent",
        automatic_loading: false,
        timeout_s: 30,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .sql-query-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 8,
        w: 10,
        content: "SQL Editor",
        component_name: "SqlQueryComponent",
        name: "",
        query: "SELECT activity, count(*) AS n FROM events GROUP BY activity",
        query_asset: null,
        row_limit: 25,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .kpi-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 2,
        w: 3,
        content: "KPI (by SQL)",
        component_name: "KpiComponent",
        title: "",
        query: "SELECT count(*) AS value FROM events",
        query_asset: null,
        value_column: "",
        prefix: "",
        suffix: "",
        decimals: 0,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .bar-chart-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 5,
        w: 6,
        content: "Bar Chart (by SQL)",
        component_name: "BarChartComponent",
        title: "",
        query: "SELECT activity AS label, count(*) AS value FROM events GROUP BY activity ORDER BY value DESC",
        query_asset: null,
        label_column: "",
        value_column: "",
        horizontal: false,
        show_values: false,
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .scatter-plot-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 5,
        w: 6,
        content: "Scatter Plot (by SQL)",
        component_name: "ScatterPlotComponent",
        title: "",
        query: "SELECT count(*) AS x, count(DISTINCT activity) AS y, obj_id AS series\nFROM event_object JOIN events USING (event_id)\nGROUP BY obj_id LIMIT 500",
        query_asset: null,
        x_column: "",
        y_column: "",
        series_column: "",
        x_label: "",
        y_label: "",
        order: 0
      }]
    );

    GridStack.setupDragIn(
      ".sidepanel .pie-chart-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 6,
        w: 4,
        content: "Pie Chart",
        component_name: "PieChartComponent",
        query: '',
        query_asset: null,
        ring_text: '',
        chart_type: 'donut',
        title: '',
        label_column: '',
        value_column: '',
        show_legend: true,
        show_tooltip: true,
        order: 0
      }]
    );

  }, [grid]);

  // The panel's own markup: every tile is the same box, differing only in its
  // GridStack class, its thumbnail and its label.
  const TILE_CLASS =
    "grid-stack-item sidepanel-item flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50";

  return (
    // Two rows: the drop target stays put, the component list scrolls under
    // it. Deleting means dragging a widget onto the target, which is
    // impossible while it can scroll out of sight.
    <div className="sidepanel col-md-2 d-none d-md-block p-2 max-h-screen flex flex-col">
      <div id="trash" className="sidepanel-item shrink-0 flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <TrashTile />
        <div>Drop here to remove!</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">

      <div className={`${TILE_CLASS} text-box`}>
        <TextBoxTile />
        <div>Text Box</div>
      </div>

      <div className={`${TILE_CLASS} image-component`}>
        <ImageTile />
        <div>Image Component</div>
      </div>

      <div className={`${TILE_CLASS} variants-component`}>
        <VariantsTile />
        <div>Variants Explorer</div>
      </div>

      <div className={`${TILE_CLASS} process-area-component`}>
        <ProcessAreaTile />
        <div>Process Area</div>
      </div>

      <div className={`${TILE_CLASS} totem-miner-component`}>
        <TotemMinerTile />
        <div>TOTeM Miner</div>
      </div>

      <div className={`${TILE_CLASS} log-statistics-component`}>
        <LogStatisticsTile />
        <div>Log Statistics</div>
      </div>

      <div className={`${TILE_CLASS} oc-dotted-chart-component`}>
        <DottedChartTile />
        <div>OC Dotted Chart</div>
      </div>

      <div className={`${TILE_CLASS} new-ocdfg-component`}>
        <OcdfgArcWeightTile />
        <div>Object-Centric DFG (Arc Weight)</div>
      </div>

      <div className={`${TILE_CLASS} new-ocdfg-variants-component`}>
        <OcdfgVariantsTile />
        <div>Object-Centric DFG (Variants)</div>
      </div>

      <div className={`${TILE_CLASS} occn-component`}>
        <OccnTile />
        <div>Object-Centric Causal Net (OCCN)</div>
      </div>

      <div className={`${TILE_CLASS} ocpn-component`}>
        <OcpnTile />
        <div>OC Petri Net</div>
      </div>

      <div className={`${TILE_CLASS} sql-query-component`}>
        <SqlEditorTile />
        <div>SQL Editor</div>
      </div>

      <div className={`${TILE_CLASS} pie-chart-component`}>
        <PieChartTile />
        <div>Pie Chart</div>
      </div>

      <div className={`${TILE_CLASS} kpi-component`}>
        <KpiTile />
        <div>KPI (by SQL)</div>
      </div>

      <div className={`${TILE_CLASS} bar-chart-component`}>
        <BarChartTile />
        <div>Bar Chart (by SQL)</div>
      </div>

      <div className={`${TILE_CLASS} scatter-plot-component`}>
        <ScatterPlotTile />
        <div>Scatter Plot (by SQL)</div>
      </div>
      </div>
    </div>
  );
};

export default SidePanel;
