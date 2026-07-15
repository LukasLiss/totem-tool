import { fileTypeFromBlob } from "file-type";

export const EVENT_LOG_FILE_ACCEPT = ".json,.xml,.sqlite,.db,.csv,.duckdb";
const PROJECT_NAME_SUFFIX = "_project";

const EVENT_LOG_TYPE_LABELS: Record<string, string> = {
  csv: "CSV",
  db: "DB",
  duckdb: "DuckDB",
  json: "JSON",
  sqlite: "SQLite",
  xml: "XML",
};

export function projectNameFromEventLogFilename(filename: string) {
  const leafName = filename.split(/[\\/]/).pop()?.trim() ?? "";
  const filenameStem = leafName.replace(/\.[^.]+$/, "").trim();
  const baseName = filenameStem || "event_log";
  return `${baseName.slice(0, 100 - PROJECT_NAME_SUFFIX.length)}${PROJECT_NAME_SUFFIX}`;
}

export function eventLogFileType(filename: string) {
  const pathWithoutQuery = filename.split(/[?#]/, 1)[0];
  const leafName = pathWithoutQuery.split(/[\\/]/).pop() ?? "";
  const extension = leafName.match(/\.([^.]+)$/)?.[1].toLowerCase();
  return extension ? EVENT_LOG_TYPE_LABELS[extension] ?? extension.toUpperCase() : "-";
}

export async function validateEventLogFile(file: File) {
  let detectedExtension: string | undefined;
  try {
    detectedExtension = (await fileTypeFromBlob(file))?.ext;
  } catch {
    // Text-based OCEL files may not contain enough bytes for signature detection.
  }

  const name = file.name.toLowerCase();
  const isSupported =
    detectedExtension === "json" ||
    detectedExtension === "xml" ||
    detectedExtension === "sqlite" ||
    detectedExtension === "db" ||
    detectedExtension === "csv" ||
    name.endsWith(".json") ||
    name.endsWith(".xml") ||
    name.endsWith(".sqlite") ||
    name.endsWith(".db") ||
    name.endsWith(".csv") ||
    name.endsWith(".duckdb");

  if (!isSupported) {
    throw new Error("Supported types: JSON, XML, SQLite, CSV, and DuckDB.");
  }
}
