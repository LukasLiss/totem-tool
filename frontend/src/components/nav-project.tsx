import { ChevronRight, Database, FolderKanban, Image as ImageIcon } from "lucide-react"
import { useContext } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { DashboardContext } from "@/contexts/DashboardContext"
import { TOUR_IDS } from "@/tour/tourIds"

const projectItems = [
  { id: "modelAssets", label: "Model Assets", icon: Database },
  { id: "imageAssets", label: "Images", icon: ImageIcon },
] as const;

export function NavProject() {
  const { viewMode, setViewMode } = useContext(DashboardContext);
  const isProjectActive =
    viewMode.type === "modelAssets" || viewMode.type === "imageAssets";

  return (
    <SidebarGroup>
      <SidebarMenu>
        <Collapsible asChild className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip="Project Assets"
                data-active={isProjectActive}
                data-tour-id={TOUR_IDS.NAV_PROJECT}
              >
                <FolderKanban />
                <span>Project Assets</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {projectItems.map((item) => (
                  <SidebarMenuSubItem key={item.id}>
                    <SidebarMenuSubButton
                      onClick={() => setViewMode({ type: item.id })}
                      data-active={viewMode.type === item.id}
                    >
                      <item.icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  )
}

