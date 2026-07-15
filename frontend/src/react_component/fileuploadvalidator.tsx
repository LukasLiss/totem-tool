import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { uploadEventLog } from "@/api/fileApi";
import { createProject } from "@/api/projectApi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWorkspace } from "@/contexts/useWorkspace";
import {
  projectNameFromEventLogFilename,
  validateEventLogFile,
} from "@/lib/eventLogFiles";

export function FileUploadValidator() {
  const { selectedProject, selectProject, selectEventLog } = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (incomingFiles) => setFile(incomingFiles[0] ?? null),
    multiple: false,
    disabled: isUploading,
  });

  const validateFile = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return false;
    }

    try {
      await validateEventLogFile(file);
    } catch (error) {
      toast.error("Invalid file type", {
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!(await validateFile()) || !file) return;

    setIsUploading(true);
    try {
      let targetProject = selectedProject;
      if (!targetProject) {
        targetProject = await createProject(
          projectNameFromEventLogFilename(file.name),
        );
        selectProject(targetProject);
      }
      const eventLog = await uploadEventLog({
        projectId: targetProject.id,
        file,
      });
      selectEventLog(eventLog);
      toast.success("Event log uploaded", { description: file.name });
      setFile(null);
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error("Event log could not be uploaded");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Upload className="size-5" />
          Upload event log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div
            {...getRootProps({
              className:
                "flex min-h-36 cursor-pointer items-center justify-center rounded-md border border-dashed p-5 text-center text-sm transition-colors hover:bg-muted/50 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
              "data-disabled": isUploading,
            })}
          >
            <input {...getInputProps()} />
            <span>
              {isDragActive
                  ? "Drop the event log here"
                  : selectedProject
                    ? "Choose or drop an OCEL file"
                    : "Choose or drop an OCEL file to create a project"}
            </span>
          </div>
          <div className="min-h-9 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            {file?.name ?? "No file selected"}
          </div>
          <CardFooter className="p-0">
            <Button
              className="w-full"
              type="submit"
              disabled={!file || isUploading}
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

export default FileUploadValidator;
