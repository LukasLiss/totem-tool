import { ChevronRight } from "lucide-react"


import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
 } from "@/components/ui/sidebar"
import { DashboardContext,  } from "@/contexts/DashboardContext"
import { useContext } from "react"


export function DevDash() {
    const { setSelectedDashboard } = useContext(DashboardContext);
    
  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
            <SidebarMenuButton tooltip={"Development View to see all Components"} onClick={() => {setSelectedDashboard(-1); 
              console.log('Context set to DevDash')}}>
                  
                  <span>Dev Dashboard</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
            </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
