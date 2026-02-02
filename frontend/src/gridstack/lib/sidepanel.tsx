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
      ".sidepanel .number-events",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 2, w: 2, content: "Number of Events", component_name: "NumberOfEventsComponent", font_size: 14, text: "", order: 0 }]  // Added custom properties
    );

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

    console.log("Drag-in setup complete");
  }, [grid]);

  return (
    <div className="sidepanel col-md-2 d-none d-md-block p-2 ">
      <div id="trash" className="sidepanel-item flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/trash.png" width="50" height="50"/>
        <div>Drop here to remove!</div>
      </div>

      <div className="grid-stack-item sidepanel-item number-events flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/numbers.jpg" width="100" height="70"/>
        <div>Number of Events</div>
      </div>

      <div className="grid-stack-item sidepanel-item text-box flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/text.jpg" width="100" height="50"/>
        <div>Text Box</div>
      </div>

      <div className="grid-stack-item sidepanel-item image-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/adgu8l.jpg" width="100" height="50"/>
        <div>Image Component</div>
      </div>

      <div className="grid-stack-item sidepanel-item variants-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/variants.svg" width="100" height="50"/>
        <div>Variants Explorer</div>
      </div>

      <div className="grid-stack-item sidepanel-item process-area-component flex flex-col justify-center items-center border p-2 m-2 gap-2 rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50">
        <img src="src/images/variants.svg" width="100" height="50"/>
        <div>Process Area</div>
      </div>
    </div>
  );
};

export default SidePanel;
