import { ChevronRight, Plus, FileStack, Settings2 } from "lucide-react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { addDashboard, deleteDashboard, getDashboards, renameDashboard } from "@/api/dashboardApi"
import { SelectedFileContext } from "@/contexts/SelectedFileContext"


export function NavDashboard({
  dashboards,
  refreshDashboards,
}: {
  dashboards: { id: number; project: number; name: string; order_in_project: number; created_at: string }[];
  refreshDashboards: () => Promise<void> | void;
}) {
  const [ dashboardname, setDashboardname] = useState("");
  const [ open, setOpen] = useState(false);
  const [ openRename, setOpenRename ] = useState(false);
  const [ openDelete, setOpenDelete ] = useState(false);
  const [dashboardToRename, setDashboardToRename] = useState<null | { id: number; name: string }>(null);
  const [dashboardToDelete, setDashboardToDelete] = useState<null | { id: number; name: string }>(null);



  const { selectedFile } = useContext(SelectedFileContext);
  console.log("NavDashboard received dashboards:", dashboards);
  const handleAddDashboard = async () => {
    const token = localStorage.getItem("access_token");
    if (!selectedFile?.project) return;
    try {
      await addDashboard(dashboardname, selectedFile.project, token);
      await refreshDashboards();   // ✅ ask parent to reload dashboards
      setOpen(false);              // ✅ close dialog
      setDashboardname("");        // ✅ reset input field
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed");
    }
  };

  const handleChangeName = async () => {
  if (!dashboardToRename) return; // nothing selected

  const token = localStorage.getItem("access_token");
  try {
    await renameDashboard(dashboardToRename.id, dashboardname, token);  // ✅ pass ID here
    await refreshDashboards();
    setOpenRename(false);
    setDashboardname("");
    setDashboardToRename(null); // reset
  } catch (err) {
    console.error("Rename failed:", err);
    alert("Rename failed");
  }
};


  const handleSubmit = async (e) => {
    e.preventDefault();
    await handleAddDashboard();
    await fetchDashboards();
 };

  const handleDeleteDashboard = async () => {

  const token = localStorage.getItem("access_token");
  try {
    await deleteDashboard(dashboardToDelete.id, token);  
    await refreshDashboards();
    setOpenDelete(false);
    setDashboardToDelete(null); // reset
  } catch (err) {
    console.error("Delete failed:", err);
    alert("Delete failed");
  }
};



  return (
    <div>
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
                      <SidebarMenuSubButton className="flex w-full items-center justify-between">
                        {/* Dashboard name (fills left side) */}
                        <span>{dashboard.name}</span>

                        {/* Settings dropdown (right side) */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1 hover:bg-accent rounded"
                              onClick={(e) => e.stopPropagation()} // stop row click
                            >
                              <Settings2 className="w-4 h-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => {
                                setDashboardToRename(dashboard);     // store selected dashboard
                                setDashboardname(dashboard.name);    // prefill input field
                                setOpenRename(true);                 // open rename dialog
                              }}
                            >
                              Rename
                            </DropdownMenuItem>

                            <DropdownMenuItem onClick={() => {
                                setDashboardToDelete(dashboard);     // store selected dashboard
                                setOpenDelete(true);                 // open rename dialog
                              }}>
                              Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}

                  {/* Add new dashboard button */}
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild>
                      <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger>
                          Add Dashboard +
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              try {
                                await handleAddDashboard();
                                setOpen(false); // ✅ close only after success
                              } catch (err) {
                                console.error("Upload failed:", err);
                              }
                            }}
                          >
                            <DialogHeader>
                              <DialogTitle>Create new Dashboard</DialogTitle>
                              <DialogDescription>
                                Add a new Dashboard to your project.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid gap-3">
                                <Label htmlFor="name-1">Name</Label>
                                <Input
                                  id="name-1"
                                  name="name"
                                  value={dashboardname}
                                  onChange={(e) => setDashboardname(e.target.value)}
                                  placeholder="Dashboard Name"
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <DialogClose asChild>
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
    {/* Rename dialog */}
    <Dialog open={openRename} onOpenChange={setOpenRename}>
        <DialogContent className="sm:max-w-[425px]">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await handleChangeName();
                setOpenRename(false); // ✅ close only after success
              } catch (err) {
                console.error("Rename failed:", err);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename Dashboard</DialogTitle>
              <DialogDescription>
                Rename existing Dashboard.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-3">
                <Label htmlFor="name-1">Name</Label>
                <Input
                  id="name-1"
                  name="name"
                  value={dashboardname}
                  onChange={(e) => setDashboardname(e.target.value)}
                  placeholder={dashboardToRename?.name || "Dashboard Name"}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>  
      {/* Delete dialog */}
      <Dialog open={openDelete} onOpenChange={setOpenDelete}>
        <DialogContent className="sm:max-w-[425px]">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await handleDeleteDashboard();
                setOpenDelete(false); // ✅ close only after success
              } catch (err) {
                console.error("Delete failed:", err);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Delete Dashboard</DialogTitle>
              <DialogDescription>
                Do you really want to delete this dashboard? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-3">
                <Label htmlFor="name-1">Dashboard</Label>
                <div className="p-2 rounded-md bg-muted text-sm">
                  {dashboardToDelete?.name || "No dashboard selected"}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit">Delete</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>  

    </div>
  )
}
