import type { FileRejection } from "react-dropzone";

export function modelAssetDropRejectionMessage(
  fileRejections: FileRejection[]
): string {
  const errorCodes = new Set(
    fileRejections.flatMap((rejection) =>
      rejection.errors.map((error) => error.code)
    )
  );

  if (errorCodes.has("too-many-files") || fileRejections.length > 1) {
    return "Select one JSON model file at a time.";
  }
  if (errorCodes.has("file-invalid-type")) {
    return "Only JSON model files are supported.";
  }
  return "The selected model file could not be added.";
}
