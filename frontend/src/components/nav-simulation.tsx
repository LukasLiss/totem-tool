import { ChevronRight, Layers, Play } from "lucide-react"
import { useContext } from "react"
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
import { DashboardContext } from "@/contexts/DashboardContext"

export function NavSimulation() {
  const { viewMode, setViewMode } = useContext(DashboardContext);

  const isSimulationActive = viewMode.type === 'simulation';

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Simulation</SidebarGroupLabel>
      <SidebarMenu>
        <Collapsible asChild defaultOpen className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip="Simulation" data-active={isSimulationActive}>
                <Play />
                <span>Simulation</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <SidebarMenuSub>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    onClick={() => setViewMode({ type: 'simulation' })}
                    data-active={isSimulationActive}
                  >
                    <Layers className="w-4 h-4" />
                    <span>Process Area Based</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  )
}
