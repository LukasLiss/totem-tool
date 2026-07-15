import axios from "axios";

export interface EventLog {
  id: number;
  project: number;
  file: string;
  uploaded_at: string;
  updated_at: string;
}

interface EventLogListResponse {
  results: EventLog[];
}

export interface UploadEventLogParams {
  projectId: number;
  file: File;
}

const FILES_URL = "http://localhost:8000/api/files/";

export async function uploadEventLog({ projectId, file }: UploadEventLogParams) {
  const formData = new FormData();
  formData.append("project", String(projectId));
  formData.append("file", file);
  const { data } = await axios.post<EventLog>(FILES_URL, formData);
  return data;
}

export async function listEventLogs(projectId: number) {
  const url = `${FILES_URL}?project=${projectId}`;
  const { data } = await axios.get<EventLog[] | EventLogListResponse>(url);
  return Array.isArray(data) ? data : data.results;
}

export async function deleteEventLog(eventLogId: number) {
  await axios.delete(`${FILES_URL}${eventLogId}/`);
}

export async function processFile(fileId: string | number) {
  const { data } = await axios.get<number>(`${FILES_URL}${fileId}/NoE/`);
  return data;
}
