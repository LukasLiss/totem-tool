import React, { ComponentProps, useEffect, useContext } from "react";
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
  GridStackRender,
  GridStackRenderProvider,
  useGridStackContext,
} from "./gridstack/lib";
import type { ComponentDataType,
  ComponentMap } from "../lib/grid-stack-render";
import "./styles/demo.css";
import { DashboardContext } from "./contexts/DashboardContext";
import { getLayout, saveLayout } from "./api/componentsApi";
import { SaveGridButton } from "./components/save_grid_button";

const CELL_HEIGHT = 40;
const BREAKPOINTS = [
  { c: 1, w: 700 },
  { c: 4, w: 850 },
  { c: 6, w: 950 },
  { c: 8, w: 1100 },
];

function Text({ content }: { content: string }) {
  return <div >{content}</div>;
}

function Chart({ content }: { content: string }) {
  return <div >{content}</div>;
}

function Map({ content }: { content: string }) {
  return <div >{content}</div>;
}


const COMPONENT_MAP: ComponentMap = {
  Text,
  Chart,
  Map,
  // ... other components here
};

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
  const token = localStorage.getItem("token");
  const EMPTY_LAYOUT: GridStackOptions = {
    ...gridOptions,
    children: []
  };
  const { selectedDashboard, setSelectedDashboard } = useContext(DashboardContext);
  const [initialLayout, setInitialLayout] = React.useState<GridStackOptions>(EMPTY_LAYOUT);
  //  const grid = GridStack.get('.grid-stack');
  //  const layout = grid.engine.save();



    useEffect(() => {
    async function load() {
      try { 
        const token = localStorage.getItem("token");
        const result = await getLayout(selectedDashboard, token);
        const children = result.components.map(c => ({
          id: String(c.id),
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          content: JSON.stringify({
            name: c.component_name,
            props: c.props,
          }),
        }));

        setInitialLayout({
          ...gridOptions,
          children,
        });
        console.log('Successfully loaded initial Layout')
      } catch (err)  {
        console.log('Could not load initial layout')
      }
    }

    load();
  }, [selectedDashboard]);

  if (!initialLayout) return <div>Loading...</div>;



    return (

    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <GridStackProvider initialOptions={initialLayout}>
          <GridStackRenderProvider>
            <div className="grid-container">
              <DnDSidebar/>

              <SaveGridButton dashboardId={selectedDashboard} token={token}/>

              <GridStackRender componentMap={COMPONENT_MAP} />
            </div>
          </GridStackRenderProvider>
        </GridStackProvider>
      </SidebarInset>
    </SidebarProvider>
            
    );
}

export default Grid;