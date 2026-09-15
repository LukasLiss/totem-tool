import axios from "axios";

export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await axios.post("/api/files/", formData, { _skipGlobalFilter: true });
  return data;
}

export async function getUserFiles() {
  const { data } = await axios.get("/api/files/", { _skipGlobalFilter: true });
  return data;
}

export async function processFile(fileId: string | number) {
  // Honors the active global filter (the interceptor appends its params),
  // so the shown event count matches the rest of the tool.
  const { data } = await axios.get(`/api/files/${fileId}/NoE/`);
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
  } catch (err: any) {
    const message =
      err?.response?.data?.error ||
      (err?.response ? `Query execution failed: ${err.response.status} ${err.response.statusText}` : err?.message) ||
      "Query execution failed";
    throw new Error(message);
  }
}
