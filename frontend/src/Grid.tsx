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
  GridStackRender,
  GridStackRenderProvider,
  useGridStackContext,
} from "./gridstack/lib";
import type { ComponentDataType,
  ComponentMap } from "../lib/grid-stack-render";
import "./styles/demo.css";



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





function DebugInfo() {
  const { initialOptions, saveOptions } = useGridStackContext();

  const [realtimeOptions, setRealtimeOptions] = useState<
    GridStackOptions | GridStackWidget[] | undefined
  >(undefined);

  useEffect(() => {
    const timer = setInterval(() => {
      if (saveOptions) {
        const data = saveOptions();
        setRealtimeOptions(data);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [saveOptions]);

  return (
    <div>
      <h2>Debug Info</h2>
      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(2, 1fr)",
        }}
      >
        <div>
          <h3>Initial Options</h3>
          <pre
            style={{
              backgroundColor: "#f3f4f6",
              padding: "1rem",
              borderRadius: "0.25rem",
              overflow: "auto",
            }}
          >
            {JSON.stringify(initialOptions, null, 2)}
          </pre>
        </div>
        <div>
          <h3>Realtime Options (2s refresh)</h3>
          <pre
            style={{
              backgroundColor: "#f3f4f6",
              padding: "1rem",
              borderRadius: "0.25rem",
              overflow: "auto",
            }}
          >
            {JSON.stringify(realtimeOptions, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}



export function Grid() {
   
  //saving stuff
  //  const grid = GridStack.get('.grid-stack');
  //  const layout = grid.engine.save();



    return (

    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <GridStackProvider initialOptions={gridOptions}>
          <GridStackRenderProvider>
            <div className="grid-container">
              <DnDSidebar/>
              <GridStackRender componentMap={COMPONENT_MAP} />
            </div>
          </GridStackRenderProvider>
        </GridStackProvider>
      </SidebarInset>
    </SidebarProvider>
            
    );
}

export default Grid;