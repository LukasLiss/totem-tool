import React, { useEffect } from "react";

import { GridStackDemo } from "./gridstack/lib/demo";
import "./styles/grid_demo.css";
import {
  SidebarInset,
  SidebarProvider} from "@/components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";

export function Grid() {
   
    return (

    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
          <GridStackDemo/>


      </SidebarInset>
    </SidebarProvider>
            
    );
}

export default Grid;