import { Play } from "lucide-react"
import { useContext } from 'react'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { DashboardContext } from "@/contexts/DashboardContext"
import { TOUR_IDS } from "@/tour/tourIds"

export function NavPlayout() {
  const { viewMode, setViewMode } = useContext(DashboardContext);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Simulation</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Object-Centric Playout"
            onClick={() => setViewMode({ type: 'playout' })}
            data-active={viewMode.type === 'playout'}
            data-tour-id={TOUR_IDS.NAV_PLAYOUT}
          >
            <Play />
            <span>Playout</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

