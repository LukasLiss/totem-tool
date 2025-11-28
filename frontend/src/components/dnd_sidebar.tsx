"use client"

import React, { ComponentProps, useState, useEffect, useContext } from "react";
import {
  AudioWaveform, BookOpen, Bot, Command, Frame, GalleryVerticalEnd,
  Map, PieChart, Settings2, SquareTerminal, FileStack, ArrowUp01
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavDashboard } from "@/components/nav-dashboard"
import { NavProjects } from "@/components/nav-projects"
import { Switcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import { getUserFiles } from "../api/fileApi"
import { DevDash } from "./nav-dev-dash";
import { getDashboards } from "@/api/dashboardApi";
import {
  GridStackProvider,
  GridStackRender,
  GridStackRenderProvider,
  useGridStackContext,
} from "../gridstack/lib";
import { GridStackOptions, GridStackWidget } from "gridstack";

import type { ComponentDataType,
  ComponentMap } from "../gridstack/lib/grid-stack-render";

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

function MapWidget({ content }: { content: string }) {
  return <div >{content}</div>;
}
const COMPONENT_MAP: ComponentMap = {
  Text,
  Chart,
  Map: MapWidget,
  // ... other components here
};


const gridOptions: GridStackOptions = {
  acceptWidgets: true,
  columnOpts: {
    breakpointForWindow: true,
    breakpoints: BREAKPOINTS,
    layout: "list",
    columnMax: 12,
  },
  margin: 100,
  cellHeight: CELL_HEIGHT,
  subGridOpts: {
    acceptWidgets: true,
    columnOpts: {
      breakpoints: BREAKPOINTS,
      layout: "list",
    },
    margin: 8,
    minRow: 2,
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


export function DnDSidebar() {
  const { addWidget } = useGridStackContext();

  const handleAdd = (name: string) => {
    const id = `widget-${Math.random().toString(36).substring(2, 15)}`;
    addWidget({
      id,
      w: 4,
      h: 2,
      x: 0,
      y: 0,
      content: JSON.stringify({ name, props: {} }),
    });
  };

  return ( 
    <Sidebar variant="sidebar" side="right" className="border-l border-border">
      <SidebarHeader>Choose new components</SidebarHeader>
      <SidebarContent>
        <button onClick={() => handleAdd("Text")}>Text</button>
        <button onClick={() => handleAdd("Chart")}>Chart</button>
        <button onClick={() => handleAdd("Map")}>Map</button>
      </SidebarContent>
      <SidebarTrigger />
    </Sidebar>
  );
}

