import React, { useEffect } from "react";
import { GridStack } from "gridstack";
import { useGrid } from "./gridstackprovider";
import {
  Trash, CirclePlus
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
      ".sidepanel .totem-model-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{
        h: 4,
        w: 4,
        content: "TOTeM Model",
        component_name: "TotemModelComponent",
        initial_tau: 0.9,
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

      <div className="grid-stack-item sidepanel-item log-statistics-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/log-statistics-preview.png" width="100" height="70"/>
        <div>Log Statistics</div>
      </div>

      <div className="grid-stack-item sidepanel-item ocdfg-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/ocdfg-preview.png" width="100" height="50"/>
        <div>OCDFG</div>
      </div>

      <div className="grid-stack-item sidepanel-item totem-model-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <div>TOTeM Model</div>
      </div>
    </div>
  );
};

export default SidePanel;
