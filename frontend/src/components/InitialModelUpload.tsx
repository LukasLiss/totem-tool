import { useEffect, useState, type FormEvent } from "react";
import { Upload, Workflow } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import {
  extractAssetApiError,
  uploadAsset,
  validateAssetUpload,
} from "@/api/assetsApi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/contexts/useWorkspace";
import {
  inferModelAssetType,
  modelAssetNameFromFilename,
} from "@/lib/modelAssetFiles";

export function InitialModelUpload() {
  const { selectedProject } = useWorkspace();
  const [modelName, setModelName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const resetForm = () => {
    setModelName("");
    setFile(null);
  };

  useEffect(() => {
    setModelName("");
    setFile(null);
  }, [selectedProject?.id]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/json": [".json"] },
    onDrop: (incomingFiles) => {
      const nextFile = incomingFiles[0] ?? null;
      setFile(nextFile);
      setModelName(nextFile ? modelAssetNameFromFilename(nextFile.name) : "");
    },
    multiple: false,
    disabled: !selectedProject || isUploading,
  });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject) {
      toast.error("Select or create a project first");
      return;
    }
    if (!modelName.trim()) {
      toast.error("Enter a model name");
      return;
    }
    if (!file) {
      toast.error("Choose a model file");
      return;
    }

    setIsUploading(true);
    try {
      const assetType = await inferModelAssetType(file);
      await validateAssetUpload({ assetType, file });
      await uploadAsset({
        projectId: selectedProject.id,
        name: modelName.trim(),
        assetType,
        file,
      });
      toast.success("Model uploaded", { description: modelName.trim() });
      resetForm();
    } catch (error) {
      toast.error("Model could not be uploaded", {
        description: extractAssetApiError(error).message,
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Workflow className="size-5" />
          Upload model
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="workspace-model-name">Name</Label>
            <Input
              id="workspace-model-name"
              value={modelName}
              maxLength={100}
              disabled={!selectedProject || isUploading}
              onChange={(event) => setModelName(event.target.value)}
            />
          </div>

          <div
            {...getRootProps({
              className:
                "flex min-h-24 cursor-pointer items-center justify-center rounded-md border border-dashed p-4 text-center text-sm transition-colors hover:bg-muted/50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
              "data-disabled": !selectedProject || isUploading,
            })}
          >
            <input {...getInputProps()} />
            <span>
              {!selectedProject
                ? "Select or create a project"
                : isDragActive
                  ? "Drop the model here"
                  : "Choose or drop a model JSON"}
            </span>
          </div>

          <div className="min-h-9 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            {file?.name ?? "No file selected"}
          </div>

          <CardFooter className="p-0">
            <Button
              className="w-full"
              type="submit"
              disabled={!selectedProject || !file || !modelName.trim() || isUploading}
            >
              <Upload />
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </CardFooter>
        </form>
      </CardContent>
    </Card>
  );
}
