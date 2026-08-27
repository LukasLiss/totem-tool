import axios from "axios";

/**
 * API layer for the OCEL editor.
 *
 * All editing logic runs in the backend (totem_lib.ocel.editor); the
 * frontend only fetches paginated slices of the log and sends edits back.
 */

const BASE = "http://localhost:8000/api/ocel-editor";

export type EditorObjectRef = {
  object_id: string;
  object_type?: string;
  qualifier?: string | null;
};

export type EditorEvent = {
  id: string;
  activity: string;
  /** Unix seconds. */
  timestamp: number;
  attributes: Record<string, string>;
  objects: EditorObjectRef[];
};

export type EditorObject = {
  id: string;
  type: string;
  attributes: Record<string, string>;
  relations: { target: string; qualifier: string | null }[];
  event_count?: number;
};

export type EditorRelation = {
  source: string;
  target: string;
  qualifier: string | null;
  source_type?: string | null;
  target_type?: string | null;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type SessionSummary = {
  num_events: number;
  num_objects: number;
  num_e2o: number;
  num_o2o: number;
  object_types: string[];
  activities: string[];
  event_attribute_columns: string[];
  object_attribute_columns: string[];
};

export type EditorSession = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  summary: SessionSummary;
};

export type EventListParams = {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  search?: string;
  activity?: string;
  object_type?: string;
  object_id?: string;
};

export type ObjectListParams = {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  search?: string;
  object_type?: string;
};

export type RelationListParams = {
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  search?: string;
};

function cleanParams(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

export async function createEmptySession(name?: string): Promise<EditorSession> {
  const { data } = await axios.post(`${BASE}/`, { mode: "empty", name });
  return data;
}

export async function createSessionFromUpload(file: File): Promise<EditorSession> {
  const formData = new FormData();
  formData.append("mode", "upload");
  formData.append("file", file);
  const { data } = await axios.post(`${BASE}/`, formData);
  return data;
}

export async function createSessionFromProject(fileId: number | string): Promise<EditorSession> {
  const { data } = await axios.post(`${BASE}/`, { mode: "project", file_id: fileId });
  return data;
}

export async function getSession(sessionId: string): Promise<EditorSession> {
  const { data } = await axios.get(`${BASE}/${sessionId}/`);
  return data;
}

export async function renameSession(sessionId: string, name: string): Promise<EditorSession> {
  const { data } = await axios.patch(`${BASE}/${sessionId}/`, { name });
  return data;
}

export async function discardSession(sessionId: string): Promise<void> {
  await axios.delete(`${BASE}/${sessionId}/`);
}

export async function listEvents(
  sessionId: string,
  params: EventListParams
): Promise<Page<EditorEvent>> {
  const { data } = await axios.get(`${BASE}/${sessionId}/events/`, {
    params: cleanParams(params),
  });
  return data;
}

export async function createEvent(
  sessionId: string,
  event: { id: string; activity: string; timestamp: number; attributes: Record<string, string>; objects: EditorObjectRef[] }
): Promise<EditorEvent> {
  const { data } = await axios.post(`${BASE}/${sessionId}/events/`, event);
  return data;
}

export async function updateEvent(
  sessionId: string,
  eventId: string,
  changes: Partial<{ id: string; activity: string; timestamp: number; attributes: Record<string, string>; objects: EditorObjectRef[] }>
): Promise<EditorEvent> {
  const { data } = await axios.patch(`${BASE}/${sessionId}/events/detail/`, {
    event_id: eventId,
    ...changes,
  });
  return data;
}

export async function deleteEvent(sessionId: string, eventId: string): Promise<void> {
  await axios.delete(`${BASE}/${sessionId}/events/detail/`, {
    params: { event_id: eventId },
  });
}

export async function listObjects(
  sessionId: string,
  params: ObjectListParams
): Promise<Page<EditorObject>> {
  const { data } = await axios.get(`${BASE}/${sessionId}/objects/`, {
    params: cleanParams(params),
  });
  return data;
}

export async function createObject(
  sessionId: string,
  object: { id: string; type: string; attributes?: Record<string, string> }
): Promise<EditorObject> {
  const { data } = await axios.post(`${BASE}/${sessionId}/objects/`, object);
  return data;
}

export async function updateObject(
  sessionId: string,
  objectId: string,
  changes: Partial<{ id: string; type: string; attributes: Record<string, string> }>
): Promise<EditorObject> {
  const { data } = await axios.patch(`${BASE}/${sessionId}/objects/detail/`, {
    object_id: objectId,
    ...changes,
  });
  return data;
}

export async function deleteObject(sessionId: string, objectId: string): Promise<void> {
  await axios.delete(`${BASE}/${sessionId}/objects/detail/`, {
    params: { object_id: objectId },
  });
}

export async function listRelations(
  sessionId: string,
  params: RelationListParams
): Promise<Page<EditorRelation>> {
  const { data } = await axios.get(`${BASE}/${sessionId}/relations/`, {
    params: cleanParams(params),
  });
  return data;
}

export async function setRelation(
  sessionId: string,
  relation: { source: string; target: string; qualifier?: string | null }
): Promise<EditorRelation> {
  const { data } = await axios.post(`${BASE}/${sessionId}/relations/`, relation);
  return data;
}

export async function deleteRelation(
  sessionId: string,
  source: string,
  target: string
): Promise<void> {
  await axios.delete(`${BASE}/${sessionId}/relations/`, {
    params: { source, target },
  });
}

export async function getLatex(
  sessionId: string,
  table: "e2o" | "o2o",
  filters: Record<string, string | undefined> = {}
): Promise<{ latex: string; rows: number; total: number; truncated: boolean }> {
  const { data } = await axios.get(`${BASE}/${sessionId}/latex/`, {
    params: cleanParams({ table, ...filters }),
  });
  return data;
}

/** Download the log in the given format; triggers a browser download. */
export async function downloadExport(
  sessionId: string,
  fmt: "duckdb" | "sqlite" | "json" | "xml",
  name: string
): Promise<void> {
  const response = await axios.get(`${BASE}/${sessionId}/export/`, {
    params: { fmt },
    responseType: "blob",
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  const safeName = (name || "ocel").replace(/[^\w.-]+/g, "-").toLowerCase();
  link.download = `${safeName}.${fmt === "duckdb" ? "duckdb" : fmt}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function saveAsProject(
  sessionId: string,
  name: string
): Promise<{ project_id: number; project_name: string; file_id: number; file: string }> {
  const { data } = await axios.post(`${BASE}/${sessionId}/save-as-project/`, { name });
  return data;
}

/** Extract a readable message from an axios error for toasts. */
export function editorErrorMessage(error: unknown): string {
  const err = error as { response?: { data?: { error?: string; detail?: string } }; message?: string };
  return (
    err?.response?.data?.error ||
    err?.response?.data?.detail ||
    err?.message ||
    "Something went wrong"
  );
}
