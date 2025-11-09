import { AppSidebar } from "@/components/app-sidebar"
import { useContext } from "react";
import {
  SidebarInset,
  SidebarProvider
} from "@/components/ui/sidebar"
import { DashboardContext } from "./contexts/DashboardContext"
import { DevDashboard } from "./components/dev_dashboard";


export function ProcessOverview() {  
      const { selectedDashboard } = useContext(DashboardContext);
      
      


      
      
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {selectedDashboard === "DevDash" && (
          <>
            {console.log("DevDash activated")}
            <DevDashboard />
          </>
        )}

      </SidebarInset>
    </SidebarProvider>
  )
}
 
export default ProcessOverview;