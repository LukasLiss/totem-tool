import { ChevronRight, Database } from "lucide-react"
import { useContext } from "react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { DashboardContext } from "@/contexts/DashboardContext"

export function NavProjectAssets() {
  const { viewMode, setViewMode } = useContext(DashboardContext);
  const isActive = viewMode.type === "modelAssets";

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Project</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Model Assets"
            onClick={() => setViewMode({ type: "modelAssets" })}
            data-active={isActive}
          >
            <Database />
            <span>Model Assets</span>
            <ChevronRight className="ml-auto transition-transform duration-200" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
