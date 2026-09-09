import { ChevronRight, GitCompareArrows, Network } from "lucide-react"
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
import {
  ConformanceComponent,
  DashboardContext,
} from "@/contexts/DashboardContext"
import { TOUR_IDS } from "@/tour/tourIds"

const conformanceItems: {
  id: ConformanceComponent;
  label: string;
  icon: typeof GitCompareArrows;
}[] = [
  { id: "totem", label: "TOTeM Conformance", icon: GitCompareArrows },
  { id: "occn", label: "OCCN Conformance", icon: Network },
];

export function NavConformance() {
  const { viewMode, setViewMode } = useContext(DashboardContext);
  const activeComponent =
    viewMode.type === "conformance" ? viewMode.component : null;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <Collapsible asChild className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip="Conformance"
                data-active={viewMode.type === "conformance"}
                data-tour-id={TOUR_IDS.NAV_CONFORMANCE}
              >
                <GitCompareArrows />
                <span>Conformance</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {conformanceItems.map((item) => (
                  <SidebarMenuSubItem key={item.id}>
                    <SidebarMenuSubButton
                      onClick={() =>
                        setViewMode({ type: "conformance", component: item.id })
                      }
                      data-active={activeComponent === item.id}
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

