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

// Execute a SQL query on OCEL data
export async function executeQuery(token: string, fileId: string, query: string) {
  const response = await fetch(`http://localhost:8000/api/files/${fileId}/execute_query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Query execution failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}