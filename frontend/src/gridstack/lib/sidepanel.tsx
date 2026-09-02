import React, { useEffect } from "react";
import { GridStack } from "gridstack";
import { useGrid } from "./gridstackprovider";
import {
  Trash, CirclePlus, Image, TextInitial, Hash
} from "lucide-react"


const SidePanel: React.FC = () => {
  const { grid } = useGrid();

  useEffect(() => {
    console.log("Setting up drag-in for grid:", grid);
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
      [{ h: 4, w: 6, content: "Variants Explorer", component_name: "VariantsComponent", automatic_loading: false, leading_object_type: '', order: 0 }]
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
      ".sidepanel .ocdfg-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 6,
        w: 8,
        content: "OCDFG",
        component_name: "OCDFGComponent",
        show_controls: true,
        initial_interaction_locked: true,
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
        row_limit: 25,
        order: 0
      }]
    );

    console.log("Drag-in setup complete");
  }, [grid]);

  return (
    <div className="sidepanel col-md-2 d-none d-md-block p-2 max-h-screen overflow-y-auto">
      <div id="trash" className="sidepanel-item flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/trash-icon.svg" width="50" height="50"/>
        <div>Drop here to remove!</div>
      </div>

      <div className="grid-stack-item sidepanel-item text-box flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/textbox-icon.svg" width="100" height="50"/>
        <div>Text Box</div>
      </div>

      <div className="grid-stack-item sidepanel-item image-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/image-icon.svg" width="100" height="50"/>
        <div>Image Component</div>
      </div>

      <div className="grid-stack-item sidepanel-item variants-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/variants-preview.png" width="100" height="50"/>
        <div>Variants Explorer</div>
      </div>

      <div className="grid-stack-item sidepanel-item process-area-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/process-area-preview.png" width="100" height="50"/>
        <div>Process Area</div>
      </div>

      <div className="grid-stack-item sidepanel-item totem-miner-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/process-area-preview.png" width="100" height="50"/>
        <div>TOTeM Miner</div>
      </div>

      <div className="grid-stack-item sidepanel-item log-statistics-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/log-statistics-preview.png" width="100" height="70"/>
        <div>Log Statistics</div>
      </div>

      <div className="grid-stack-item sidepanel-item ocdfg-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/ocdfg-preview.png" width="100" height="50"/>
        <div>OCDFG</div>
      </div>

      <div className="grid-stack-item sidepanel-item oc-dotted-chart-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <svg
          width="100"
          height="50"
          viewBox="0 0 100 50"
          role="img"
          aria-label="OC Dotted Chart preview"
          className="rounded-md bg-white"
        >
          <line x1="14" y1="8" x2="14" y2="40" stroke="#475569" strokeWidth="2" />
          <line x1="14" y1="40" x2="90" y2="40" stroke="#475569" strokeWidth="2" />
          <circle cx="25" cy="33" r="3" fill="#2563eb" />
          <circle cx="39" cy="29" r="3" fill="#16a34a" />
          <circle cx="52" cy="24" r="3" fill="#dc2626" />
          <circle cx="67" cy="18" r="3" fill="#ca8a04" />
          <circle cx="80" cy="13" r="3" fill="#9333ea" />
          <circle cx="31" cy="21" r="2.5" fill="#0891b2" />
          <circle cx="58" cy="34" r="2.5" fill="#db2777" />
          <circle cx="75" cy="28" r="2.5" fill="#65a30d" />
        </svg>
        <div>OC Dotted Chart</div>
      </div>

      <div className="grid-stack-item sidepanel-item new-ocdfg-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/ocdfg-preview.png" width="100" height="50"/>
        <div>Object-Centric DFG (Arc Weight)</div>
      </div>

      <div className="grid-stack-item sidepanel-item new-ocdfg-variants-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/ocdfg-preview.png" width="100" height="50"/>
        <div>Object-Centric DFG (Variants)</div>
      </div>

      <div className="grid-stack-item sidepanel-item occn-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <svg
          width="100"
          height="50"
          viewBox="0 0 100 50"
          role="img"
          aria-label="OCCN preview"
          className="rounded-md bg-white"
        >
          <line x1="26" y1="25" x2="42" y2="25" stroke="#475569" strokeWidth="2" />
          <line x1="58" y1="25" x2="74" y2="25" stroke="#475569" strokeWidth="2" />
          <rect x="8" y="17" width="18" height="16" rx="3" fill="#2563eb" />
          <rect x="42" y="17" width="18" height="16" rx="3" fill="#16a34a" />
          <rect x="74" y="17" width="18" height="16" rx="3" fill="#ca8a04" />
          <circle cx="38" cy="12" r="3" fill="#dc2626" />
          <circle cx="64" cy="12" r="3" fill="#9333ea" />
          <circle cx="38" cy="38" r="3" fill="#0891b2" />
          <circle cx="64" cy="38" r="3" fill="#db2777" />
        </svg>
        <div>Object-Centric Causal Net (OCCN)</div>
      </div>

      <div className="grid-stack-item sidepanel-item ocpn-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <svg
          width="100"
          height="50"
          viewBox="0 0 100 50"
          role="img"
          aria-label="OC Petri Net preview"
          className="rounded-md bg-white"
        >
          <circle cx="14" cy="18" r="7" fill="none" stroke="#2563eb" strokeWidth="2" />
          <circle cx="14" cy="38" r="7" fill="none" stroke="#10b981" strokeWidth="2" />
          <rect x="40" y="18" width="20" height="16" rx="3" fill="none" stroke="#475569" strokeWidth="2" />
          <circle cx="86" cy="26" r="7" fill="none" stroke="#2563eb" strokeWidth="2" />
          <line x1="21" y1="18" x2="40" y2="24" stroke="#2563eb" strokeWidth="2" />
          <line x1="21" y1="38" x2="40" y2="30" stroke="#10b981" strokeWidth="2" />
          <line x1="60" y1="26" x2="79" y2="26" stroke="#475569" strokeWidth="2" />
        </svg>
        <div>OC Petri Net</div>
      </div>

      <div className="grid-stack-item sidepanel-item sql-query-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <svg
          width="100"
          height="50"
          viewBox="0 0 100 50"
          role="img"
          aria-label="SQL Editor preview"
          className="rounded-md bg-white"
        >
          <rect x="6" y="6" width="88" height="38" rx="3" fill="none" stroke="#475569" strokeWidth="2" />
          <line x1="6" y1="18" x2="94" y2="18" stroke="#475569" strokeWidth="2" />
          <text x="12" y="15" fontSize="7" fill="#7c3aed" fontFamily="monospace">SELECT</text>
          <text x="12" y="28" fontSize="6" fill="#334155" fontFamily="monospace">activity, count(*)</text>
          <text x="12" y="38" fontSize="6" fill="#334155" fontFamily="monospace">FROM events</text>
        </svg>
        <div>SQL Editor</div>
      </div>
    </div>
  );
};

export default SidePanel;
