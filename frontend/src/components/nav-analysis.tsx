import { ChevronRight, BarChart3, Network, TextAlignStart, ChartScatter, Workflow, CircleDot, Database } from "lucide-react"
import { BoxesArrowRight, CausalNet } from "@/components/icons/totem-icons"
import { useContext, useEffect, useState } from 'react'
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
import { DashboardContext, AnalysisComponent } from "@/contexts/DashboardContext"
import { TOUR_IDS } from "@/tour/tourIds"
import { useOptionalTourController } from "@/tour/TourController"

const analysisItems: { id: AnalysisComponent; label: string; icon: typeof BarChart3 }[] = [
  { id: 'processArea', label: 'Process Area', icon: Network },
  { id: 'totemMiner', label: 'TOTeM Miner', icon: Workflow },
  { id: 'occn', label: 'OCCN', icon: CausalNet },
  { id: 'ocPetriNet', label: 'OC Petri Net', icon: CircleDot },
  { id: 'ocdfg', label: 'OC-DFG', icon: BoxesArrowRight },
  { id: 'variants', label: 'Variants', icon: TextAlignStart },
  { id: 'dottedChart', label: 'OC Dotted Chart', icon: ChartScatter },
  { id: 'sqlQuery', label: 'SQL Queries', icon: Database },
];

export function NavAnalysis() {
  const { viewMode, setViewMode } = useContext(DashboardContext);
  const tour = useOptionalTourController();
  const currentTourId = tour?.state.active ? tour.state.currentTourId : null;
  const [isOpen, setIsOpen] = useState(false);

  const isAnalysisActive = viewMode.type === 'analysis';
  const activeComponent = viewMode.type === 'analysis' ? viewMode.component : null;

  useEffect(() => {
    if (currentTourId === TOUR_IDS.OPEN_DOTTED_CHART || isAnalysisActive) {
      setIsOpen(true);
    }
  }, [currentTourId, isAnalysisActive]);

  return (
    <SidebarGroup>
      <SidebarMenu>
        <Collapsible
          open={isOpen}
          onOpenChange={setIsOpen}
          asChild
          className="group/collapsible"
        >
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton
                tooltip="Analysis Tools"
                data-active={isAnalysisActive}
                data-tour-id={TOUR_IDS.NAV_ANALYSIS}
              >
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
                      data-tour-id={item.id === 'dottedChart' ? TOUR_IDS.OPEN_DOTTED_CHART : undefined}
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

