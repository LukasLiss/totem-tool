import axios from "axios";

export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await axios.post("http://localhost:8000/api/files/", formData);
  return data;
}

export async function getUserFiles() {
  const { data } = await axios.get("http://localhost:8000/api/files/");
  return data;
}

export async function processFile(token: string, fileId: string) {
  const response = await fetch(`http://localhost:8000/api/files/${fileId}/NoE/`, {
    method: "GET", // since our Django @action uses GET
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    throw new Error(`Processing file failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
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