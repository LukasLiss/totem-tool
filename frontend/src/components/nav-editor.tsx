import { ChevronRight, PenLine, Workflow, CircleDot, Table2 } from "lucide-react"
import { BoxesArrowRight, CausalNet } from "@/components/icons/totem-icons"
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
import { DashboardContext, EditorComponent } from "@/contexts/DashboardContext"

// Each editor edits the model type its Analysis entry shows, so the two
// sections share a glyph per model.
const editorItems: { id: EditorComponent; label: string; icon: typeof Workflow }[] = [
  { id: 'totem', label: 'TOTeM Model', icon: Workflow },
  { id: 'occn', label: 'OC Causal Net', icon: CausalNet },
  { id: 'ocpn', label: 'OC Petri Net', icon: CircleDot },
  { id: 'ocdfg', label: 'OC-DFG', icon: BoxesArrowRight },
  { id: 'ocel', label: 'OCEL Editor', icon: Table2 },
];

export function NavEditor() {
  const { viewMode, setViewMode } = useContext(DashboardContext);

  const isEditorActive = viewMode.type === 'editor';
  const activeComponent = viewMode.type === 'editor' ? viewMode.component : null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Editor</SidebarGroupLabel>
      <SidebarMenu>
        <Collapsible asChild defaultOpen className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip="Model Editors" data-active={isEditorActive}>
                <PenLine />
                <span>Editor</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <SidebarMenuSub>
                {editorItems.map((item) => (
                  <SidebarMenuSubItem key={item.id}>
                    <SidebarMenuSubButton
                      onClick={() => setViewMode({ type: 'editor', component: item.id })}
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
