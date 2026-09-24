import { ChevronRight, FileStack, Settings2, Plus } from "lucide-react"
import { useContext, useRef, useState } from 'react'
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



  const { selectedFile } = useContext(SelectedFileContext);

  // Only one of these dialogs is open at a time, so one flag covers all three.
  // It keeps the submit button disabled for as long as the request is in
  // flight: without it, impatient clicks on "Save changes" sent a POST each and
  // created a dashboard each.
  //
  // The ref is what actually holds the line. Clicks arriving in the same tick
  // all run before React re-renders the button as disabled, and each handler
  // would read the same stale `isSubmitting === false`; a ref is updated
  // synchronously, so every click after the first turns back here.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);

  const beginSubmit = () => {
    if (submitting.current) return false;
    submitting.current = true;
    setIsSubmitting(true);
    return true;
  };

  const endSubmit = () => {
    submitting.current = false;
    setIsSubmitting(false);
  };

  const handleAddDashboard = async () => {
    const name = dashboardname.trim();
    if (!selectedFile?.project || !name) return;
    if (!beginSubmit()) return;

    try {
      await addDashboard(name, selectedFile.project);
      await refreshDashboards();
      setOpen(false);
      setDashboardname("");
    } catch {
      toast.error("Dashboard could not be created");
    } finally {
      endSubmit();
    }
  };

  const handleChangeName = async () => {
    const name = dashboardname.trim();
    if (!dashboardToRename || !name) return;
    if (!beginSubmit()) return;

    try {
      await renameDashboard(dashboardToRename.id, name);
      await refreshDashboards();
      setOpenRename(false);
      setDashboardname("");
      setDashboardToRename(null);
    } catch {
      toast.error("Dashboard could not be renamed");
    } finally {
      endSubmit();
    }
  };

  const handleDeleteDashboard = async () => {
    if (!dashboardToDelete) return;
    if (!beginSubmit()) return;

    try {
      await deleteDashboard(dashboardToDelete.id);
      // Nothing can be shown for a dashboard that no longer exists: staying on
      // it leaves an empty grid whose layout can neither be loaded nor saved.
      // Forced, because edit mode's unsaved-changes guard would otherwise ask
      // whether to discard a layout that has just been deleted.
      if (viewMode.type === "dashboard" && viewMode.id === dashboardToDelete.id) {
        setViewMode({ type: "overview" }, { force: true });
      }
      await refreshDashboards();
      setOpenDelete(false);
      setDashboardToDelete(null);
    } catch {
      toast.error("Dashboard could not be deleted");
    } finally {
      endSubmit();
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
                >
                  <FileStack />
                  <span>Dashboards</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>

              {/* Expandable list of dashboards */}
              <CollapsibleContent>
                <SidebarMenuSub>
                  {/* The menu is a sibling of the row, not a child of it. A
                      menu item lives in a portal, so when the menu closes the
                      browser resolves the click onto whatever is underneath —
                      the row — and picking "Delete" also re-entered the
                      dashboard, which in edit mode raised the discard prompt on
                      top of the delete dialog. (It was also a <button> inside
                      an <a>.) */}
                  {dashboards.map((dashboard) => (
                    <SidebarMenuSubItem key={dashboard.id} className="flex w-full items-center">
                      <SidebarMenuSubButton
                        className="min-w-0 flex-1"
                        onClick={() => {
                          setViewMode({ type: 'dashboard', id: dashboard.id });
                        }}
                      >
                        <span className="truncate" title={dashboard.name}>
                          {dashboard.name}
                        </span>
                      </SidebarMenuSubButton>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Actions for ${dashboard.name}`}
                            title={`Actions for ${dashboard.name}`}
                            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shrink-0 rounded p-1"
                          >
                            <Settings2 className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onClick={() => {
                              setDashboardToRename(dashboard);
                              setDashboardname(dashboard.name);
                              setOpenRename(true);
                            }}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setDashboardToDelete(dashboard);
                              setOpenDelete(true);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuSubItem>
                  ))}

                  {/* Add new dashboard button */}
                  <SidebarMenuSubItem>
                    <Dialog
                      open={open}
                      onOpenChange={(next) => {
                        if (isSubmitting) return;
                        setOpen(next);
                        // Never reopen carrying the last attempt's text.
                        if (next) setDashboardname("");
                      }}
                    >
                      <SidebarMenuSubButton asChild className="cursor-pointer">
                        <DialogTrigger>
                          <Plus className="w-4 h-4 shrink-0" />
                          <span className="truncate">Add Dashboard</span>
                        </DialogTrigger>
                      </SidebarMenuSubButton>
                      <DialogContent className="sm:max-w-[425px]">
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleAddDashboard();
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
                                <Label htmlFor="new-dashboard-name">Name</Label>
                                <Input
                                  id="new-dashboard-name"
                                  name="name"
                                  value={dashboardname}
                                  onChange={(e) => setDashboardname(e.target.value)}
                                  placeholder="Dashboard Name"
                                  maxLength={100}
                                  autoFocus
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <DialogClose asChild>
                                <Button type="button" variant="outline" disabled={isSubmitting}>
                                  Cancel
                                </Button>
                              </DialogClose>
                              <Button
                                type="submit"
                                disabled={isSubmitting || !dashboardname.trim()}
                              >
                                {isSubmitting ? "Creating…" : "Save changes"}
                              </Button>
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
    <Dialog
      open={openRename}
      onOpenChange={(next) => {
        if (!isSubmitting) setOpenRename(next);
      }}
    >
        <DialogContent className="sm:max-w-[425px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleChangeName();
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
                <Label htmlFor="rename-dashboard-name">Name</Label>
                <Input
                  id="rename-dashboard-name"
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
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={isSubmitting || !dashboardname.trim()}
              >
                {isSubmitting ? "Renaming…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Delete dialog */}
      <Dialog
        open={openDelete}
        onOpenChange={(next) => {
          if (!isSubmitting) setOpenDelete(next);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDeleteDashboard();
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
                <Label>Dashboard</Label>
                <div className="p-2 rounded-md bg-muted text-sm">
                  {dashboardToDelete?.name || "No dashboard selected"}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>  

    </div>
  )
}
