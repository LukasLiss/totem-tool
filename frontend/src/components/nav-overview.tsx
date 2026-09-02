import { ChevronRight, LayoutDashboard } from "lucide-react"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { DashboardContext } from "@/contexts/DashboardContext"
import { useContext } from "react"

export function NavOverview() {
  const { viewMode, setViewMode } = useContext(DashboardContext);
  const isActive = viewMode.type === 'overview';

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Overview - See all components"
            onClick={() => setViewMode({ type: 'overview' })}
            data-active={isActive}
          >
            <LayoutDashboard />
            <span>Overview</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
