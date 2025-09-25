import { ChevronRight, Plus, FileStack } from "lucide-react"
import React, { useContext, useEffect, useState } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { addDashboard, getDashboards } from "@/api/dashboardApi"
import { SelectedFileContext } from "@/contexts/SelectedFileContext"


export function NavDashboard({
  dashboards,
}: {
  dashboards: {
    id: number
    project: number
    name: string
    order_in_project: number
    created_at: string
  }[]
}) {
  const [ dashboardname, setDashboardname] = useState("");
  const { selectedFile } = useContext(SelectedFileContext);
  console.log("NavDashboard received dashboards:", dashboards);
  const handleAddDashboard = async () => {
      const token = localStorage.getItem("access_token");
      try {
        const projectId = selectedFile?.project;
        const response = await addDashboard(dashboardname, projectId,  token);
        console.log("Successfully added Dashboard:", response);
      } catch (err) {
        console.error("Upload failed:", err);
        alert("Upload failed");
      }
    };
  const handleSubmit = async (e) => {
    e.preventDefault();
    await handleAddDashboard();
 };
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Dashboards</SidebarGroupLabel>
      <SidebarMenu>
        <Collapsible asChild className="group/collapsible">
          <SidebarMenuItem>
            {/* Main permanent button */}
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip="Dashboards">
                <FileStack />
                <span>Dashboards</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>

            {/* Expandable list of dashboards */}
            <CollapsibleContent>
              <SidebarMenuSub>
                {dashboards.map((dashboard) => (
                  <SidebarMenuSubItem key={dashboard.id}>
                    <SidebarMenuSubButton asChild>
                      <span>{dashboard.name}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}

                {/* Add new dashboard button */}
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton asChild>
                    <Dialog>
                        <DialogTrigger>
                          Add Dashboard +
                        </DialogTrigger>
                          
                            <DialogContent className="sm:max-w-[425px]">
                              <form onSubmit={handleSubmit}>
                                <DialogHeader>
                                  <DialogTitle>Create new Dashboard</DialogTitle>
                                  <DialogDescription>
                                    Add a new Dashboard to your project.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4"> {/* Added py-4 for spacing */}
                                  <div className="grid gap-3">
                                    <Label htmlFor="name-1">Name</Label>
                                    <Input
                                      id="name-1"
                                      name="name"
                                      value={dashboardname}
                                      onChange={(e) => setDashboardname(e.target.value)}
                                      placeholder="My Awesome Dashboard"
                                    />
                                  </div>
                                </div>
                                <DialogFooter>
                                  <DialogClose asChild>
                                    {/* Added type="button" to prevent this from submitting the form */}
                                    <Button type="button" variant="outline">Cancel</Button>
                                  </DialogClose>
                                  <Button type="submit">Save changes</Button>
                                </DialogFooter>
                              </form>
                            </DialogContent>
                    </Dialog>
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
