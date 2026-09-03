import { ChevronRight, FileStack, Settings2, Plus } from "lucide-react"
import { useContext,  useState } from 'react'
import { TOUR_IDS } from "@/tour/tourIds"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { addDashboard, deleteDashboard, renameDashboard } from "@/api/dashboardApi"
import { SelectedFileContext } from "@/contexts/SelectedFileContext"
import { DashboardContext } from "@/contexts/DashboardContext";
import { useNavigate } from "react-router-dom";


function isUnauthorizedError(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHORIZED";
}



export function NavDashboard({
  dashboards,
  refreshDashboards,
}: {
  dashboards: { id: number; project: number; name: string; order_in_project: number; created_at: string }[];
  refreshDashboards: () => Promise<void> | void;
}) {
  const { viewMode, setViewMode } = useContext(DashboardContext);
  const [ dashboardname, setDashboardname] = useState("");
  const [ open, setOpen] = useState(false);
  const [ openRename, setOpenRename ] = useState(false);
  const [ openDelete, setOpenDelete ] = useState(false);
  const [dashboardToRename, setDashboardToRename] = useState<null | { id: number; name: string }>(null);
  const [dashboardToDelete, setDashboardToDelete] = useState<null | { id: number; name: string }>(null);
  const navigate = useNavigate()



  const { selectedFile } = useContext(SelectedFileContext);
  console.log("NavDashboard received dashboards:", dashboards);
  const handleAddDashboard = async () => {
    if (!selectedFile?.project) return;
    try {
      const newDash = await addDashboard(dashboardname, selectedFile.project);
      await refreshDashboards();   // ✅ ask parent to reload dashboards
      if (newDash?.id) {
        setViewMode({ type: 'dashboard', id: newDash.id });
      }
      setOpen(false);              // ✅ close dialog
      setDashboardname("");        // ✅ reset input field
    } catch (error: unknown) {
              if (isUnauthorizedError(error)) {
                navigate("/login", {
                  replace: true,
                  state: { from: location.pathname },
                });
              } else {
      console.error("Upload failed:", error);
      toast.error("Dashboard could not be created");
    }
  };
};

  const handleChangeName = async () => {
  if (!dashboardToRename) return;

  try {
    await renameDashboard(dashboardToRename.id, dashboardname);
    await refreshDashboards();
    setOpenRename(false);
    setDashboardname("");
    setDashboardToRename(null); // reset
  } catch (error: unknown) {
              if (isUnauthorizedError(error)) {
                navigate("/login", {
                  replace: true,
                  state: { from: location.pathname },
                });
              } else {
      console.error("Rename failed:", error);
      toast.error("Dashboard could not be renamed");
    }
  };
};

  const handleDeleteDashboard = async () => {
    if (!dashboardToDelete) return;

    try {
      await deleteDashboard(dashboardToDelete.id);
      await refreshDashboards();
      setOpenDelete(false);
      setDashboardToDelete(null); // reset
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) {
        navigate("/login", {
          replace: true,
          state: { from: location.pathname },
        });
      } else {
        console.error("Delete failed:", error);
        toast.error("Dashboard could not be deleted");
      }
    }
  };



  return (
    <div>
      <SidebarGroup>
        <SidebarMenu>
          <Collapsible asChild className="group/collapsible">
            <SidebarMenuItem>
              {/* Main permanent button */}
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip="Dashboards"
                  data-active={viewMode.type === 'dashboard'}
                  data-tour-id={TOUR_IDS.NAV_DASHBOARD}
                >
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
                      <SidebarMenuSubButton className="flex w-full items-center justify-between"
                      onClick={() => {
                        console.log("Dashboard clicked:", dashboard);
                        setViewMode({ type: 'dashboard', id: dashboard.id });
                      }}>
                        <span className="flex-1 truncate"
                        title={dashboard.name}

                        >{dashboard.name}</span>

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
                    <Dialog open={open} onOpenChange={setOpen}>
                      <SidebarMenuSubButton asChild className="cursor-pointer" data-tour-id={TOUR_IDS.DASHBOARD_ADD_BTN}>
                        <DialogTrigger>
                          <Plus className="w-4 h-4 shrink-0" />
                          <span className="truncate">Add Dashboard</span>
                        </DialogTrigger>
                      </SidebarMenuSubButton>
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
                                  data-tour-id={TOUR_IDS.DASHBOARD_NAME_INPUT}
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
                              <Button type="submit" data-tour-id={TOUR_IDS.DASHBOARD_SAVE_BTN}>Save changes</Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
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
                  maxLength={100}
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
