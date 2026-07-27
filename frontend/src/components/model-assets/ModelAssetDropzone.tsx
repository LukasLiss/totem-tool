import { CircleAlert, FileJson, Upload } from "lucide-react";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

import { cn } from "@/lib/utils";

import { modelAssetDropRejectionMessage } from "./dropzoneRejection";

export interface ModelAssetDropzoneProps {
  file: File | null;
  error: string | null;
  disabled?: boolean;
  onFileChange: (file: File) => void;
  onErrorChange: (error: string | null) => void;
}

const JSON_ACCEPT = {
  "application/json": [".json"],
} as const;

export function ModelAssetDropzone({
  file,
  error,
  disabled = false,
  onFileChange,
  onErrorChange,
}: ModelAssetDropzoneProps) {
  const handleDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        onErrorChange(modelAssetDropRejectionMessage(fileRejections));
        return;
      }

      const selectedFile = acceptedFiles[0];
      if (!selectedFile) return;

      onErrorChange(null);
      onFileChange(selectedFile);
    },
    [onErrorChange, onFileChange]
  );
  const {
    getInputProps,
    getRootProps,
    isDragActive,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    accept: JSON_ACCEPT,
    disabled,
    maxFiles: 1,
    multiple: false,
    onDrop: handleDrop,
  });
  const rejected = isDragReject || Boolean(error);
  const state = disabled
    ? "disabled"
    : rejected
      ? "rejected"
      : isDragActive
        ? "active"
        : file
          ? "selected"
          : "idle";
  const title = error && file
    ? file.name
    : rejected
    ? "This selection cannot be added"
    : isDragActive
      ? "Drop the JSON model here"
      : file
        ? file.name
        : "Drop a JSON model here or click to select";
  const description =
    error ??
    (isDragReject
      ? "Only one .json model file can be dropped here."
      : file
        ? "Drop or select another file to replace it."
        : "One .json file");

  return (
    <div
      {...getRootProps({
        "aria-label": "Select a JSON model file",
        className: cn(
          "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "hover:border-foreground/40 hover:bg-muted/40",
          isDragAccept && "border-primary bg-primary/5",
          rejected && "border-destructive bg-destructive/5",
          file && !isDragActive && !rejected && "border-solid bg-muted/30",
          disabled && "pointer-events-none cursor-not-allowed opacity-50"
        ),
        "data-state": state,
      })}
    >
      <input {...getInputProps()} />
      {rejected ? (
        <CircleAlert className="size-6 text-destructive" />
      ) : file && !isDragActive ? (
        <FileJson className="size-6 text-primary" />
      ) : (
        <Upload
          className={cn(
            "size-6 text-muted-foreground",
            isDragAccept && "text-primary",
            rejected && "text-destructive"
          )}
        />
      )}
      <p className="text-sm font-medium">{title}</p>
      <p
        className={cn(
          "text-xs text-muted-foreground",
          error && "text-destructive"
        )}
        aria-live="polite"
      >
        {description}
      </p>
    </div>
  );
}

export default ModelAssetDropzone;
