import { ChevronRight, BarChart3, Network, GitBranch } from "lucide-react"
import { useContext } from 'react'
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
import { DashboardContext, AnalysisComponent } from "@/contexts/DashboardContext"

const analysisItems: { id: AnalysisComponent; label: string; icon: typeof BarChart3 }[] = [
  { id: 'processArea', label: 'Process Area', icon: BarChart3 },
  { id: 'ocdfg', label: 'OC-DFG', icon: Network },
  { id: 'variants', label: 'Variants', icon: GitBranch },
];

export function NavAnalysis() {
  const { viewMode, setViewMode } = useContext(DashboardContext);

  const isAnalysisActive = viewMode.type === 'analysis';
  const activeComponent = viewMode.type === 'analysis' ? viewMode.component : null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Analysis</SidebarGroupLabel>
      <SidebarMenu>
        <Collapsible asChild defaultOpen className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip="Analysis Tools" data-active={isAnalysisActive}>
                <BarChart3 />
                <span>Analysis</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <SidebarMenuSub>
                {analysisItems.map((item) => (
                  <SidebarMenuSubItem key={item.id}>
                    <SidebarMenuSubButton
                      onClick={() => setViewMode({ type: 'analysis', component: item.id })}
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
