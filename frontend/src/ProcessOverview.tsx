import { AppSidebar } from "@/components/app-sidebar"
import { useContext } from "react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";

import Grid from './components/grid';
import DevGrid from "./components/grid_dev";

const development = false;

export function ProcessOverview() {
      const { selectedDashboard } = useContext(DashboardContext);

  return (
    <SidebarProvider>
      <AppSidebar />
     
      <SidebarInset>
        <div>
          <SidebarTrigger />
          {selectedDashboard === -1 ? (
            <>
              {console.log("DevDash activated")}
              <DevDashboard />
            </>) : (development ? <DevGrid /> : <Grid />)
          }
        </div>


      </SidebarInset>
    </SidebarProvider>
  )
}

export default ProcessOverview;