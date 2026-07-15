import { useState, type FormEvent } from "react";
import { AlertCircle, FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  type AssetType,
  extractAssetApiError,
  uploadAsset,
  validateAssetUpload,
} from "@/api/assetsApi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/contexts/useWorkspace";
import { useProjectCatalog } from "@/hooks/useProjectCatalog";
import {
  inferModelAssetType,
  modelAssetNameFromFilename,
} from "@/lib/modelAssetFiles";

export function ProjectWorkspacePicker() {
  const { selectedProject, selectProject } = useWorkspace();
  const {
    projects,
    isLoading,
    isCreating,
    errorMessage,
    addProject,
  } = useProjectCatalog();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [includeModel, setIncludeModel] = useState(false);
  const [modelName, setModelName] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setProjectName("");
    setIncludeModel(false);
    setModelName("");
    setModelFile(null);
    setIsSubmitting(false);
    setFormError(null);
  };

  const closeDialog = () => {
    setIsCreateOpen(false);
    resetForm();
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    let inferredModelType: AssetType | null = null;

    if (includeModel) {
      if (!modelName.trim()) {
        setFormError("Enter a model name.");
        return;
      }
      if (!modelFile) {
        setFormError("Choose a model file.");
        return;
      }
      try {
        inferredModelType = await inferModelAssetType(modelFile);
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : "Model file is invalid.",
        );
        return;
      }
    }

    setIsSubmitting(true);
    if (includeModel && modelFile && inferredModelType) {
      try {
        await validateAssetUpload({
          assetType: inferredModelType,
          file: modelFile,
        });
      } catch (error) {
        setFormError(extractAssetApiError(error).message);
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const project = await addProject(projectName);
      if (includeModel && modelFile && inferredModelType) {
        try {
          await uploadAsset({
            projectId: project.id,
            name: modelName.trim(),
            assetType: inferredModelType,
            file: modelFile,
          });
        } catch (error) {
          closeDialog();
          toast.error("Project created without model", {
            description: extractAssetApiError(error).message,
          });
          return;
        }
      }

      closeDialog();
      toast.success("Project created", { description: project.display_name });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Project could not be created.",
      );
      toast.error("Project could not be created");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FolderKanban className="size-5" />
            Project
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="project-select">Selected project</Label>
          <Select
            value={selectedProject ? String(selectedProject.id) : ""}
            onValueChange={(value) => {
              const project = projects.find((item) => item.id === Number(value));
              if (project) selectProject(project);
            }}
            disabled={isLoading || projects.length === 0}
          >
            <SelectTrigger id="project-select">
              <SelectValue
                placeholder={isLoading ? "Loading projects..." : "Select project"}
              />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus />
            Create project
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <form onSubmit={handleCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>
                Create a project with an optional initial model asset.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="project-name">Name (optional)</Label>
              <Input
                id="project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
              <Label htmlFor="project-initial-model">Upload model</Label>
              <Switch
                id="project-initial-model"
                checked={includeModel}
                disabled={isSubmitting}
                onCheckedChange={(checked) => {
                  setIncludeModel(checked);
                  setFormError(null);
                  if (!checked) {
                    setModelName("");
                    setModelFile(null);
                  }
                }}
              />
            </div>

            {includeModel && (
              <div className="grid gap-4 border-t pt-4">
                <div className="grid gap-2">
                  <Label htmlFor="initial-model-name">Model name</Label>
                  <Input
                    id="initial-model-name"
                    value={modelName}
                    maxLength={100}
                    disabled={isSubmitting}
                    onChange={(event) => setModelName(event.target.value)}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="initial-model-file">Model file</Label>
                  <Input
                    id="initial-model-file"
                    type="file"
                    accept=".json,application/json"
                    disabled={isSubmitting}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setModelFile(file);
                      setModelName(file ? modelAssetNameFromFilename(file.name) : "");
                    }}
                  />
                </div>
              </div>
            )}

            {formError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={closeDialog}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || isSubmitting}>
                {isCreating || isSubmitting ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
