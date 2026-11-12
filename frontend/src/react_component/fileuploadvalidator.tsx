import { useState, useRef, useContext } from "react";
import axios from "axios";
import { fileTypeFromBlob } from "file-type";
import { getUploadLimits, importProject, uploadFile } from "../api/fileApi";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import {useDropzone} from 'react-dropzone';
import { Button } from "@/components/ui/button";
import { SelectedFileContext } from "../contexts/SelectedFileContext";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"
import { isCancelledError, useComputationStore } from "@/store/computationStore";
import { prepareLargeLogFilter } from "@/store/applyGlobalFilter";
import { ProgressBar } from "@/components/ComputationPanel";

const UNLIMITED_VERSION_HINT =
  "At totem-tool.com, you can download the local or self-hosted version that has no limitations.";

/**
 * A whole project exported from TOTeM, rather than a bare event log.
 *
 * Matched on the extension: the file is a zip inside, so sniffing its bytes
 * would only say "zip" — and `.duckdb` is already recognised this way for the
 * same reason (`file-type` has no signature for it).
 */
const isProjectBundle = (file: File) =>
  file.name.toLowerCase().endsWith(".totem");

export function FileUploadValidator() {
    const { setSelectedFile } = useContext(SelectedFileContext);
    const navigate = useNavigate();

    const [file, setFile] = useState<File | null>(null);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const hiddenInputRef = useRef<HTMLInputElement | null>(null);
    const [showConversionModal, setShowConversionModal] = useState(false);
    const [isConverting, setIsConverting] = useState(false);
    const [uploadPercent, setUploadPercent] = useState<number | null>(null);
    const [uploadStage, setUploadStage] = useState<string>("");
    // The upload request is a tracked computation (see computationStore):
    // once the file is transferred, the backend reports the conversion
    // progress through it, and it can be cancelled.
    const importJob = useComputationStore((s) =>
      Object.values(s.jobs).find((job) => job.label === "Importing event log") ?? null,
    );
    const cancelComputation = useComputationStore((s) => s.cancel);


    const {getRootProps, getInputProps} = useDropzone({
      onDrop: (incomingFiles) => {
        if (hiddenInputRef.current) {
          const dataTransfer = new DataTransfer();
          incomingFiles.forEach((v) => {
            dataTransfer.items.add(v);
          });
          hiddenInputRef.current.files = dataTransfer.files;
        }
        setFile(incomingFiles[0]);
      },
      multiple: false,
    });

    const validateFile = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return false;
    }

    const type = await fileTypeFromBlob(file);

    const isJson =
      type?.ext === "json" || file.name.toLowerCase().endsWith(".json");
    const isXml =
      type?.ext === "xml" && file.name.toLowerCase().endsWith(".xml");
    const isSqlite =
      (type?.ext === "sqlite" || type?.ext === "db") &&
      (file.name.toLowerCase().endsWith(".sqlite") ||
        file.name.toLowerCase().endsWith(".db"));
    const isCsv =
      type?.ext === "csv" || file.name.toLowerCase().endsWith(".csv");
    // The `file-type` library has no DuckDB signature, so `type?.ext` is
    // undefined for valid DuckDB files. Fall back to filename matching, in
    // line with how isJson / isCsv are handled.
    const isDuckDB =
      file.name.toLowerCase().endsWith(".duckdb");

    if (!(isJson || isXml || isSqlite || isCsv || isDuckDB || isProjectBundle(file))){
        toast.error("Invalid file type", {description:"Please choose a TOTeM project (.totem) or an event log ('json', 'xml', 'sqlite', 'csv', or 'duckdb')."});
        return false;
    }

    // Checked here because a rejected upload can surface as a bare network
    // error: the server stops reading the file. It still enforces both limits.
    try {
      const limits = await getUploadLimits();
      const { max_upload_bytes: maxBytes, max_projects_per_user: maxProjects } = limits;
      if (maxProjects !== null && limits.project_count >= maxProjects) {
        toast.error("Project limit reached", {
          description: `You can have at most ${maxProjects} project${maxProjects === 1 ? "" : "s"}. Delete a project to add a new one. ${UNLIMITED_VERSION_HINT}`,
        });
        return false;
      }
      if (maxBytes !== null && file.size > maxBytes) {
        toast.error("File too large", {
          description: `Files can be at most ${Math.floor(maxBytes / (1024 * 1024))} MB. ${UNLIMITED_VERSION_HINT}`,
        });
        return false;
      }
    } catch {
      // Not knowing the limits must not block an upload.
    }

    return true;
  };

  /**
   * Restore a whole project from a `.totem` archive.
   *
   * Everything the dashboards reference travels in the same file, so unlike a
   * dashboard import this one normally has nothing to report — anything that
   * does come back is a real problem and is shown rather than swallowed.
   */
  const handleProjectImport = async (bundle: File) => {
    const result = await importProject(bundle, (progressEvent) => {
      if (progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadPercent(percent);
        setUploadStage(
          percent >= 100 ? "Restoring the project..." : `Uploading file... ${percent}%`
        );
      }
    });

    setValidationStatus("success");
    const label = result.project.display_name || result.project.name;
    if (result.warnings.length > 0) {
      toast.warning(`Imported “${label}” with ${result.warnings.length} issue${result.warnings.length === 1 ? "" : "s"}`, {
        description: (
          <ul className="list-disc pl-4 text-left space-y-1 mt-2 max-h-40 overflow-y-auto">
            {result.warnings.map((warning, index) => (
              <li key={index} className="text-xs">{warning.detail}</li>
            ))}
          </ul>
        ),
        duration: 12000,
      });
    } else {
      toast.success("Project imported", { description: label });
    }

    // Select the restored project, exactly as a finished upload does: the
    // whole serialized event log, not just its id — the project switcher
    // labels a project from `display_name` / `file` and would otherwise show
    // "Untitled project".
    if (result.file) {
      setSelectedFile(result.file as never);
      await prepareLargeLogFilter(Number(result.event_log));
    }
    setFile(null);
    setShowConversionModal(false);
    setIsConverting(false);
    setUploadPercent(null);
    setUploadStage("");
    navigate("/overview");
    setTimeout(() => setValidationStatus("idle"), 3000);
  };

  const handleFileUpload = async () => {
    try {
      if (!file) {
        toast.warning("No file selected!");
        return;
      }
      setValidationStatus('loading');
      setUploadPercent(0);
      setUploadStage("Uploading file...");

      if (isProjectBundle(file)) {
        await handleProjectImport(file);
        return;
      }

      const response = await uploadFile(file, (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadPercent(percent);
          if (percent >= 100) {
            setUploadStage("Converting to DuckDB & indexing records...");
          } else {
            setUploadStage(`Uploading file... ${percent}%`);
          }
        }
      });
      setSelectedFile(response);
      setValidationStatus('success');
      toast.success("Upload successful", {
        description: file.name,
      });
      if (response?.id != null) await prepareLargeLogFilter(Number(response.id));
      setFile(null);
      setShowConversionModal(false);
      setIsConverting(false);
      setUploadPercent(null);
      setUploadStage("");
      navigate("/overview");
      setTimeout(() => setValidationStatus('idle'), 3000);
    } catch (err: unknown) {
      setIsConverting(false);
      setUploadPercent(null);
      setUploadStage("");
      setValidationStatus(isCancelledError(err) ? 'idle' : 'error');
      setTimeout(() => setValidationStatus('idle'), 3000);

      if (isCancelledError(err)) {
        setShowConversionModal(false);
        toast.info("Upload cancelled", { description: "The file was not imported." });
      } else if (axios.isAxiosError(err) && err.response?.data?.errors) {
        const errorList = err.response.data.errors as string[];
        toast.error("Validation Failed", {
          description: (
            <div className="max-h-40 overflow-y-auto mt-2">
              <ul className="list-disc pl-4 text-left space-y-1">
                {errorList.map((e: string, i: number) => (
                  <li key={i} className="text-xs text-red-600 dark:text-red-400">{e}</li>
                ))}
              </ul>
            </div>
          ),
          duration: 10000,
        });
      } else if (axios.isAxiosError(err)) {
        const errorDesc =
          err?.response?.data?.error ||
          err?.response?.data?.file?.[0] ||
          err?.response?.data?.detail ||
          "Upload failed";
        toast.error("Upload failed", { description: errorDesc });
      } else {
        toast.error("Upload failed");
      }
    }
  };


 const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const isValid = await validateFile();
    if (isValid) {
      // A project bundle already holds a converted log, so the conversion
      // notice does not apply to it — only an event log in another format
      // has to be converted on upload.
      const needsConversion =
        file &&
        !isProjectBundle(file) &&
        !file.name.toLowerCase().endsWith(".duckdb");
      if (needsConversion) {
        setShowConversionModal(true);
      } else {
        await handleFileUpload();
      }
    }
 };


  return (
  <div className="w-full max-w-sm p-4 md:p-6">
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          Upload a new file
        </CardTitle>
      </CardHeader>
        <CardContent>
          <form className="flex flex-col" onSubmit={handleSubmit}>
            <div {...getRootProps({ className:
              "dropzone font-sans border flex flex-col items-center justify-center rounded-md px-6 pt-10 pb-12 md:px-10 md:pt-15 md:pb-20 text-center cursor-pointer transition hover:shadow-lg" })}>
              <input
                type="file"
                name="my-file"
                ref={hiddenInputRef}
                style={{ opacity: 0 }}
              />
              <input  {...getInputProps()} />
              <p className="text-lg text-primary">Click or drag and drop an OCEL file or a TOTeM project (.totem) here to start a new project</p>
            </div>

        <CardFooter className="flex-col gap-6 text-sm w-full mt-6 p-0">
          <div className="flex flex-col justify-center w-full">
            <div className="flex border rounded-md justify-center pr-2 pl-2 text-primary gap-2 w-full h-9 px-4 py-2 has-[>svg]:px-3">
                <span className="min-w-0 truncate">{file?.name ?? "No file chosen"}</span>
            </div>
              <Button 
                className="w-full flex mt-2 md:flex-row cursor-pointer transition hover:shadow-lg gap-2" 
                type="submit"
                disabled={isConverting || validationStatus === 'loading'}
              >
                {(isConverting || validationStatus === 'loading') && <Loader2 className="h-4 w-4 animate-spin" />}
                {validationStatus === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {validationStatus === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                {isConverting
                  ? uploadStage || 'Converting & Validating...'
                  : validationStatus === 'loading'
                  ? uploadStage || 'Validating...'
                  : 'Validate & Upload'}
              </Button>
          </div>
        </CardFooter>
      </form>
    </CardContent>
  </Card>

  <Dialog open={showConversionModal} onOpenChange={(open) => {
    if (!isConverting) {
      setShowConversionModal(open);
    }
  }}>
    <DialogContent
      showCloseButton={!isConverting}
      onEscapeKeyDown={(e) => {
        if (isConverting) e.preventDefault();
      }}
      onPointerDownOutside={(e) => {
        if (isConverting) e.preventDefault();
      }}
      onInteractOutside={(e) => {
        if (isConverting) e.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>DuckDB Conversion Required</DialogTitle>
        <DialogDescription>
          To ensure optimal performance across the TOTeM Tool, non-DuckDB files 
          are converted into an optimized backend storage format upon upload. 
          This process may take a few moments depending on the file size.
        </DialogDescription>
      </DialogHeader>
      {isConverting && (
        <div className="space-y-2 py-2" data-testid="upload-progress">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {uploadPercent !== null && uploadPercent >= 100 && importJob?.message
                ? importJob.message
                : uploadStage || "Processing..."}
            </span>
            {uploadPercent !== null && uploadPercent < 100 ? (
              <span>{uploadPercent}%</span>
            ) : typeof importJob?.fraction === "number" ? (
              <span>{Math.round(importJob.fraction * 100)}%</span>
            ) : null}
          </div>
          {uploadPercent !== null && uploadPercent < 100 ? (
            <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-200"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
          ) : (
            <ProgressBar fraction={importJob?.fraction ?? null} cancelling={importJob?.status === "cancelling"} />
          )}
          {importJob && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={importJob.status === "cancelling"}
                onClick={() => cancelComputation(importJob.id)}
              >
                {importJob.status === "cancelling" ? "Cancelling…" : "Cancel import"}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground italic">
            {uploadPercent !== null && uploadPercent >= 100
              ? "Building DuckDB tables, parsing timestamps, and verifying event relations. Large datasets may take up to a minute."
              : "Transferring file to server..."}
          </p>
        </div>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => setShowConversionModal(false)}
          disabled={isConverting}
        >
          Cancel
        </Button>
        <Button onClick={() => {
          setIsConverting(true);
          handleFileUpload();
        }} disabled={isConverting}>
          {isConverting ? uploadStage || "Converting & Uploading..." : "Convert and Upload"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  </div>
  );
}

export default FileUploadValidator;
