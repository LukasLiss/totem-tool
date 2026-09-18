"use client"

import { useState, useEffect, useContext, useCallback } from "react";
import { BookOpen, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { SelectedFileContext } from "../contexts/SelectedFileContext.tsx";
import { deleteProject, getUserFiles, renameProject } from "../api/fileApi"
import { useNavigate } from "react-router-dom";
import { toast } from "sonner"
import { DashboardContext } from "@/contexts/DashboardContext.tsx";

/** One row of GET /api/files/ — a project as the switcher knows it. */
type ProjectFile = {
  id: number;
  project: number;
  display_name: string;
  file: string;
  uploaded_at: string;
};

/** Project.display_name is the name the user gave it; otherwise the file name. */
const projectLabel = (project: Partial<ProjectFile> | null): string =>
  project?.display_name || project?.file?.split("/").pop() || "Untitled project";

/** The rename field is capped to Project.display_name's column width. */
const PROJECT_NAME_MAX_LENGTH = 120;

export function Switcher() {
  const { isMobile } = useSidebar()
  const { selectedFile, setSelectedFile } = useContext(SelectedFileContext);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [projectToRename, setProjectToRename] = useState<ProjectFile | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<ProjectFile | null>(null);
  const [newName, setNewName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { setViewMode } = useContext(DashboardContext)

  const displayName = selectedFile
    ? projectLabel(selectedFile)
    : "No file selected";

  const loadFiles = useCallback(async () => {
    try {
      const response: ProjectFile[] = await getUserFiles();
      setFiles(response);
      return response;
    } catch {
      toast.error("Projects could not be loaded");
      return [];
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  /** Open a dialog from inside the switcher: close the menu it was opened from. */
  const startRename = (project: ProjectFile) => {
    setMenuOpen(false);
    setProjectToRename(project);
    setNewName(projectLabel(project));
  };

  const startDelete = (project: ProjectFile) => {
    setMenuOpen(false);
    setProjectToDelete(project);
  };

  const handleRename = async () => {
    if (!projectToRename) return;
    const name = newName.trim();
    if (!name) {
      toast.error("Enter a name for the project");
      return;
    }
    setIsSubmitting(true);
    try {
      const updated = await renameProject(projectToRename.id, name);
      const refreshed = await loadFiles();
      // Keep the header in step when the renamed project is the open one.
      if (selectedFile?.id === projectToRename.id) {
        setSelectedFile(
          refreshed.find((file) => file.id === projectToRename.id) ?? updated
        );
      }
      setProjectToRename(null);
    } catch {
      toast.error("Project could not be renamed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!projectToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteProject(projectToDelete.id);
      await loadFiles();
      // Nothing can be shown for a project that no longer exists. Forced,
      // because a dashboard of that project may be open in edit mode, and its
      // unsaved-changes guard would otherwise ask whether to discard a layout
      // that has just been deleted along with everything around it.
      if (selectedFile?.id === projectToDelete.id) {
        setSelectedFile(null);
        setViewMode({ type: "overview" }, { force: true });
      }
      setProjectToDelete(null);
    } catch {
      toast.error("Project could not be deleted");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <BookOpen className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
              </div>

              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-80 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Projects
            </DropdownMenuLabel>

            {files.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => {
                  setSelectedFile(project);
                  setViewMode({ type: 'overview' });
                }}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <BookOpen className="size-3.5 shrink-0" />
                </div>
                <span className="flex-1 truncate" title={projectLabel(project)}>
                  {projectLabel(project)}
                </span>
                {/* Row actions. Every pointer event is kept off the item so
                    using them does not also switch to the project. */}
                <ProjectAction
                  label={`Rename ${projectLabel(project)}`}
                  onTrigger={() => startRename(project)}
                >
                  <Pencil className="size-3.5" />
                </ProjectAction>
                <ProjectAction
                  label={`Delete ${projectLabel(project)}`}
                  onTrigger={() => startDelete(project)}
                >
                  <Trash2 className="size-3.5" />
                </ProjectAction>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={() => navigate("/upload")}>
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">
                Add project
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Rename dialog */}
        <Dialog
          open={projectToRename !== null}
          onOpenChange={(open) => {
            if (!open) setProjectToRename(null);
          }}
        >
          <DialogContent className="sm:max-w-[425px]">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleRename();
              }}
            >
              <DialogHeader>
                <DialogTitle>Rename project</DialogTitle>
                <DialogDescription>
                  Only the name shown in this list changes. The event log and
                  everything stored in the project stay as they are.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-3">
                  <Label htmlFor="project-name">Name</Label>
                  <Input
                    id="project-name"
                    name="name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="Project name"
                    maxLength={PROJECT_NAME_MAX_LENGTH}
                    autoFocus
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting || !newName.trim()}>
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete dialog */}
        <Dialog
          open={projectToDelete !== null}
          onOpenChange={(open) => {
            if (!open) setProjectToDelete(null);
          }}
        >
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete project</DialogTitle>
              <DialogDescription>
                This removes the event log, every dashboard built on it and the
                models and images saved in the project. It cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-3">
                <Label>Project</Label>
                <div className="rounded-md bg-muted p-2 text-sm">
                  {projectToDelete ? projectLabel(projectToDelete) : ""}
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={isSubmitting}
              >
                Delete project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * An icon button living inside a dropdown item. Radix selects the item on
 * click, so the event is stopped at every stage the item listens on.
 */
function ProjectAction({
  label,
  onTrigger,
  children,
}: {
  label: string;
  onTrigger: () => void;
  children: React.ReactNode;
}) {
  const swallow = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
      onPointerDown={swallow}
      onPointerUp={swallow}
      onClick={(event) => {
        swallow(event);
        onTrigger();
      }}
    >
      {children}
    </button>
  );
}
