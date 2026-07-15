"use client"

import { useContext, useState, type FormEvent } from "react";
import { ChevronsUpDown, FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";

import { DashboardContext } from "@/contexts/DashboardContext";
import { useWorkspace } from "@/contexts/useWorkspace";
import { useProjectCatalog } from "@/hooks/useProjectCatalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function Switcher() {
  const { isMobile } = useSidebar();
  const { selectedProject, selectProject } = useWorkspace();
  const { setViewMode } = useContext(DashboardContext);
  const {
    projects,
    isLoading,
    isCreating,
    errorMessage,
    addProject,
  } = useProjectCatalog();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const project = await addProject(projectName);
      setProjectName("");
      setIsCreateOpen(false);
      setViewMode({ type: "eventLogs" });
      toast.success("Project created", { description: project.display_name });
    } catch {
      toast.error("Project could not be created");
    }
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <FolderKanban className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {selectedProject?.display_name ?? "Select project"}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-md"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Projects
              </DropdownMenuLabel>
              {isLoading && (
                <DropdownMenuItem disabled>Loading projects...</DropdownMenuItem>
              )}
              {!isLoading && projects.length === 0 && (
                <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
              )}
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => {
                    selectProject(project);
                    setViewMode({ type: "eventLogs" });
                  }}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <FolderKanban className="size-3.5" />
                  </div>
                  <span className="truncate">{project.display_name}</span>
                </DropdownMenuItem>
              ))}
              {errorMessage && (
                <DropdownMenuItem disabled className="text-destructive">
                  Projects could not be loaded
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 p-2"
                onSelect={() => setIsCreateOpen(true)}
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <Plus className="size-4" />
                </div>
                Create project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>
                The project receives an automatic display name when this field is empty.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="sidebar-project-name">Name (optional)</Label>
              <Input
                id="sidebar-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
