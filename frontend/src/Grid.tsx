import React, { ComponentProps, useEffect } from "react";
import { GridStackOptions, GridStackWidget } from "gridstack";

import { GridStackDemo } from "./gridstack/lib/demo";
import "./styles/grid_demo.css";
import {
  SidebarInset,
  SidebarProvider} from "@/components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { DnDSidebar } from "./components/dnd_sidebar";
import {
  GridStackProvider,
} from "./gridstack/lib";
import type { ComponentDataType,
  ComponentMap } from "../lib/grid-stack-render";

const CELL_HEIGHT = 40;
const BREAKPOINTS = [
  { c: 1, w: 700 },
  { c: 4, w: 850 },
  { c: 6, w: 950 },
  { c: 8, w: 1100 },
];


const gridOptions: GridStackOptions = {
  acceptWidgets: false,
  columnOpts: {
    breakpointForWindow: true,
    breakpoints: BREAKPOINTS,
    layout: "list",
    columnMax: 12,
  },
  margin: "10px",
  cellHeight: CELL_HEIGHT,
  subGridOpts: {
    acceptWidgets: false,
    column: 1,
    margin: 8,
    cellHeight: CELL_HEIGHT,
  },
  children: [
    {
      id: "item1",
      h: 5,
      w: 5,
      x: 0,
      y: 0,
      content: JSON.stringify({
        name: "Text",
        props: { content: "Item 1" },
      } satisfies ComponentDataType<ComponentProps<typeof Text>>), // if need type check
    },
    {
      id: "item2",
      h: 2,
      w: 2,
      x: 2,
      y: 0,
      content: JSON.stringify({
        name: "Text",
        props: { content: "Item 2" },
      }),
    },
    
  ],
};



export function Grid() {
   
    return (

    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <GridStackProvider initialOptions={gridOptions}>
          <div className="grid-container">
            <DnDSidebar/>
            <GridStackDemo/>
          </div>
        </GridStackProvider>
      </SidebarInset>
    </SidebarProvider>
            
    );
}

export default Grid;