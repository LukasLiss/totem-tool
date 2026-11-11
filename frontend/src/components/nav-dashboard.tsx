import { ChevronRight, FileStack, Settings2, Plus, Upload } from "lucide-react"
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
import {
  addDashboard,
  deleteDashboard,
  renameDashboard,
  exportDashboard,
  importDashboard,
  DASHBOARD_BUNDLE_SCHEMA,
  DASHBOARD_BUNDLE_VERSION,
  type DashboardImportWarning,
} from "@/api/dashboardApi"
import { downloadJson, openJsonFile, toFilename } from "@/editors/shared/io"
import { SelectedFileContext } from "@/contexts/SelectedFileContext"
import { DashboardContext } from "@/contexts/DashboardContext";

/**
 * Why a dropped file is not a dashboard, phrased for the user. Checked before
 * the request so an OCCN or TOTeM model picked by mistake is named as such
 * rather than coming back as a generic 400.
 */
function wrongFormatMessage(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "That file does not contain a dashboard.";
  }
  const { schema, version } = parsed as { schema?: unknown; version?: unknown };
  if (schema !== DASHBOARD_BUNDLE_SCHEMA) {
    return typeof schema === "string"
      ? `That is a "${schema}" file, not a dashboard.`
      : "That file does not contain a dashboard.";
  }
  // Two different faults, two different messages — as the backend already
  // does. A missing or non-numeric version means a truncated or corrupt file,
  // not one from the future.
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return "That dashboard file looks incomplete or corrupt.";
  }
  if (version > DASHBOARD_BUNDLE_VERSION) {
    return "That file was written by a newer version of TOTeM.";
  }
  return null;
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
  const [importResult, setImportResult] = useState<null | {
    dashboard: { id: number; name: string };
    warnings: DashboardImportWarning[];
  }>(null);



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

  const handleExport = async (dashboard: { id: number; name: string }) => {
    try {
      const bundle = await exportDashboard(dashboard.id);
      const filename = toFilename(dashboard.name, "dashboard");
      const outcome = await downloadJson(filename, bundle);
      // The save dialog was dismissed: nothing was written, so say nothing.
      if (outcome === "cancelled") return;
      toast.success(
        outcome === "saved"
          ? `Saved ${filename}.json`
          : `Downloading ${filename}.json`
      );
    } catch {
      toast.error("Dashboard could not be exported");
    }
  };

  const handleImport = async () => {
    if (!selectedFile?.project) {
      toast.warning("Open an event log first — an imported dashboard needs a project.");
      return;
    }
    // Deliberately *not* holding the submit lock across the file picker:
    // `openJsonFile` settles on the input's change or cancel event, and where
    // `oncancel` does not fire the promise never settles at all — which would
    // leave Add, Rename and Delete disabled for the rest of the session. The
    // lock covers the request, which is what it is for.
    let parsed: unknown;
    try {
      parsed = await openJsonFile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The file could not be read.");
      return;
    }
    // The picker was cancelled: not an error, and nothing to say about it.
    if (parsed === null) return;

    const wrongFormat = wrongFormatMessage(parsed);
    if (wrongFormat) {
      toast.error(wrongFormat);
      return;
    }

    if (!beginSubmit()) return;

    try {
      const result = await importDashboard(
        selectedFile.project,
        selectedFile.id ?? null,
        parsed
      );
      await refreshDashboards();
      toast.success(`Imported "${result.dashboard.name}"`);
      if (result.warnings.length > 0) {
        // Shown in a dialog rather than a stack of toasts: each line is
        // something the user has to go and fix, and toasts disappear.
        setImportResult(result);
      } else {
        setViewMode({ type: "dashboard", id: result.dashboard.id });
      }
    } catch (err) {
      const detail =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(detail || "Dashboard could not be imported");
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
                        data-active={
                          viewMode.type === 'dashboard' && viewMode.id === dashboard.id
                        }
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
                          <DropdownMenuItem onClick={() => handleExport(dashboard)}>
                            Export
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
                                  maxLength={30}
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

                  {/* Import creates a dashboard rather than acting on one, so
                      it belongs here beside "Add Dashboard" and not in a row's
                      own menu. The file picker is the dialog. */}
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton
                      className="cursor-pointer"
                      aria-disabled={isSubmitting}
                      onClick={() => {
                        if (!isSubmitting) handleImport();
                      }}
                    >
                      <Upload className="size-4 shrink-0" />
                      <span className="truncate">Import Dashboard</span>
                    </SidebarMenuSubButton>
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
                  maxLength={30}
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

    {/* What an import could not carry over. Every line is something to go and
        fix, so it waits for a click instead of fading like a toast. */}
    <Dialog
      open={importResult !== null}
      onOpenChange={(next) => {
        if (!next) setImportResult(null);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            Imported “{importResult?.dashboard.name}” with{" "}
            {importResult?.warnings.length}{" "}
            {importResult?.warnings.length === 1 ? "issue" : "issues"}
          </DialogTitle>
          <DialogDescription>
            The layout came across. These parts could not, because they refer to
            things this project does not have.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3 py-2 text-sm max-h-[50vh] overflow-y-auto">
          {importResult?.warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="grid gap-1">
              {warning.component_name && (
                <span className="text-xs font-medium text-muted-foreground">
                  {warning.component_name}
                </span>
              )}
              <span>{warning.detail}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => {
              if (importResult) {
                setViewMode({ type: "dashboard", id: importResult.dashboard.id });
              }
              setImportResult(null);
            }}
          >
            Open dashboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    </div>
  )
}
