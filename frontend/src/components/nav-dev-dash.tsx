import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { DashboardContext,  } from "@/contexts/DashboardContext"
import React, { useContext, useState } from "react"


export function DevDash() {
    const { setSelectedDashboard } = useContext(DashboardContext);
    
  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
            <SidebarMenuButton tooltip={"Development View to see all Components"} onClick={() => {setSelectedDashboard("DevDash"); 
              console.log('Context set to DevDash')}}>
                  
                  <span>Dev Dashboard</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
            </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
