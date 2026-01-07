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
      [{ h: 2, w: 2, content: "Text Box", component_name: "TextBoxComponent", font_size: 14, text: "", order: 0 }]  // Ensure consistency
    );

    GridStack.setupDragIn(
      ".sidepanel .image-component",
      {
        helper: "clone",
        appendTo: "body",
      },
      [{ h: 2, w: 2, content: "Image Component", component_name: "ImageComponent", font_size: 14, text: "", order: 0 }]  // Ensure consistency
    );
    
    console.log("Drag-in setup complete");
  }, [grid]);

  return (
    <div className="sidepanel col-md-2 d-none d-md-block">
      <div id="trash" className="sidepanel-item">
        <Trash/>
        <div>Drop here to remove!</div>
      </div>

      <div className="grid-stack-item sidepanel-item number-events">
        <CirclePlus/>
        <div>Number of Events</div>
      </div>

      <div className="grid-stack-item sidepanel-item text-box">
        <CirclePlus/>
        <div>Text Box</div>
      </div>

      <div className="grid-stack-item sidepanel-item image-component">
        <CirclePlus/>
        <div>Image Component</div>
      </div>
    </div>
  );
};

export default SidePanel;
