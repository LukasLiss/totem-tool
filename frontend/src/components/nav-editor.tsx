import { ChevronRight, PenLine, Share2, Workflow, CircleDot } from "lucide-react"
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

const editorItems: { id: EditorComponent; label: string; icon: typeof Share2 }[] = [
  { id: 'totem', label: 'TOTeM Model', icon: Share2 },
  { id: 'occn', label: 'OC Causal Net', icon: Workflow },
  { id: 'ocpn', label: 'OC Petri Net', icon: CircleDot },
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
              <SidebarMenuButton tooltip="Model Editors" data-active={isEditorActive} data-tour-id="sidebar-editor">
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
