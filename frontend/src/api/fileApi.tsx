import axios, { type AxiosProgressEvent } from "axios";
import { filterRequestConfig } from "@/store/filterStore";

export async function uploadFile(
  file: File,
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void
) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await axios.post("/api/files/", formData, {
    _skipGlobalFilter: true,
    onUploadProgress,
  });
  return data;
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
