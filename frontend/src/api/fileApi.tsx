import axios, { type AxiosProgressEvent } from "axios";
import { filterRequestConfig } from "@/store/filterStore";

export async function uploadFile(
  file: File,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void,
  mapping?: FlatLogMapping,
) {
  const formData = new FormData();
  formData.append("file", file);
  if (mapping) formData.append("mapping", JSON.stringify(mapping));
  const { data } = await axios.post("/api/files/", formData, {
    _skipGlobalFilter: true,
    onUploadProgress,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Case-centric ("flat") logs: XES and plain CSV, imported through a column
// mapping. See totem_lib/src/totem_lib/ocel/flat_log.py.
// ---------------------------------------------------------------------------

export type FlatLogRole =
  | "object_id"
  | "resource"
  | "activity"
  | "timestamp"
  | "event_attribute"
  | "object_attribute"
  | "ignore";

export interface FlatColumnMapping {
  column: string;
  role: FlatLogRole;
  /** object_id / resource: the object type the ids belong to. */
  object_type?: string;
  /** timestamp: "auto", "unix_s", "unix_ms" or a pattern like "dd.MM.yyyy HH:mm". */
  format?: string;
  /** timestamp: IANA zone ("Europe/Berlin") for values without an offset; UTC by default. */
  timezone?: string;
  /** object_attribute: the object id column whose objects get the attribute. */
  target?: string;
}

export interface FlatLogMapping {
  columns: FlatColumnMapping[];
  delimiter?: string | null;
}

export interface FlatLogPreviewColumn {
  name: string;
  suggestion: Omit<FlatColumnMapping, "column">;
  empty: number;
  distinct: number;
}

export interface FlatLogPreview {
  format: "xes" | "csv";
  /** "ocel_csv": an OCEL 2.0 CSV, which imports without a mapping. */
  kind: "flat" | "ocel_csv";
  columns: FlatLogPreviewColumn[];
  rows: string[][];
  delimiter: string | null;
  truncated: boolean;
  timestamp_presets: string[];
}

/** File names that may hold a case-centric log, by format. */
export function flatLogFormat(fileName: string): "xes" | "csv" | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".xes") || name.endsWith(".xes.gz")) return "xes";
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) return "csv";
  return null;
}

/** Bytes sent for a preview: enough for the first 100 events of most logs. */
const PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * Columns, suggested roles and first rows of a flat log.
 *
 * Only the start of the file is sent, so a large log is not uploaded twice;
 * the real upload follows once the user has mapped the columns.
 */
export async function previewFlatLog(file: File, delimiter?: string | null): Promise<FlatLogPreview> {
  const truncated = file.size > PREVIEW_BYTES;
  const formData = new FormData();
  formData.append("file", file.slice(0, PREVIEW_BYTES), "preview");
  formData.append("filename", file.name);
  formData.append("truncated", truncated ? "true" : "false");
  if (delimiter) formData.append("delimiter", delimiter);
  const { data } = await axios.post("/api/files/preview/", formData, { _skipGlobalFilter: true });
  return data;
}

/** What a mapped import kept and skipped (`import_report` of the upload response). */
export interface FlatLogImportReport {
  rows: number;
  events: number;
  skipped_no_activity: number;
  skipped_no_object: number;
  skipped_bad_timestamp: number;
  bad_timestamp_example: string | null;
  timestamp_format: string;
  timezone: string;
}

/** Parse sample values with a timestamp format, exactly as the import will. */
export async function parseTimestamps(
  values: string[],
  format: string,
  timezone?: string,
): Promise<(string | null)[]> {
  const { data } = await axios.post(
    "/api/files/parse-timestamps/",
    { values, format, timezone },
    { _skipGlobalFilter: true },
  );
  return data.results;
}

export interface UploadLimits {
  max_upload_bytes: number | null;
  max_projects_per_user: number | null;
  project_count: number;
}

/** Limits set by a hosted install; null means no limit. */
export async function getUploadLimits(): Promise<UploadLimits> {
  const { data } = await axios.get("/api/upload-limits/", { _skipGlobalFilter: true });
  return data;
}

export async function getUserFiles() {
  const { data } = await axios.get("/api/files/", { _skipGlobalFilter: true });
  return data;
}

/** The project an event log belongs to, as a `.totem` archive. */
export async function exportProject(fileId: string | number): Promise<Blob> {
  const { data } = await axios.get(`/api/files/${fileId}/export-project/`, {
    _skipGlobalFilter: true,
    responseType: "blob",
  });
  return data;
}

export interface ProjectImportWarning {
  code: string;
  component_name: string | null;
  detail: string;
}

export interface ProjectImportResult {
  project: { id: number; name: string; display_name: string };
  event_log: number | null;
  /** The restored event log, shaped like `/api/files/` returns one. */
  file: Record<string, unknown> | null;
  warnings: ProjectImportWarning[];
}

/**
 * Create a whole project from a `.totem` archive. Always creates a new
 * project; it never merges into an existing one.
 */
export async function importProject(
  file: File,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
): Promise<ProjectImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await axios.post("/api/files/import-project/", formData, {
    _skipGlobalFilter: true,
    onUploadProgress,
  });
  return data;
}

/** Rename the project an event log belongs to (its switcher label). */
export async function renameProject(fileId: string | number, name: string) {
  const { data } = await axios.patch(
    `/api/files/${fileId}/rename/`,
    { name },
    { _skipGlobalFilter: true }
  );
  return data;
}

/** Delete a project: its event log, dashboards, assets and uploaded files. */
export async function deleteProject(fileId: string | number) {
  await axios.delete(`/api/files/${fileId}/`, { _skipGlobalFilter: true });
}

export async function processFile(
  fileId: string | number,
  filterEnabled = true,
  localFilterParams?: Record<string, string>,
) {
  // Honors the active global filter (the interceptor appends its params),
  // so the shown event count matches the rest of the tool.
  const { data } = await axios.get(
    `/api/files/${fileId}/NoE/`,
    filterRequestConfig(localFilterParams, filterEnabled),
  );
  return data;
}

// Execute a SQL query on OCEL data.
// Goes through the shared axios instance so it honours API_BASE_URL (hosted
// builds), the token-refresh interceptor and the global-filter params, instead
// of a raw fetch against a hardcoded http://localhost:8000.
export async function executeQuery(fileId: string | number, query: string) {
  try {
    const { data } = await axios.post(`/api/files/${fileId}/execute_query/`, { query });
    return data as { data: Record<string, unknown>[]; columns: string[] };
  } catch (err) {
    let message: string | undefined;
    if (axios.isAxiosError<{ error?: string }>(err)) {
      message =
        err.response?.data?.error ||
        (err.response ? `Query execution failed: ${err.response.status} ${err.response.statusText}` : err.message);
    }
    throw new Error(message || "Query execution failed");
  }
}
