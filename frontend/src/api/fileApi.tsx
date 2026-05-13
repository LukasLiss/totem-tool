// Upload a file for the logged-in user
export async function uploadFile(file: File, token: string) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("http://localhost:8000/api/files/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, 
    },
    body: formData,
  });
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Fetch the list of files for the logged-in user
export async function getUserFiles(token: string) {
  const response = await fetch("http://localhost:8000/api/files/", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
   if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    throw new Error(`Fetching files failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
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
export async function executeQuery(token: string, fileId: string, query: string, signal?: AbortSignal) {
  const response = await fetch(`http://localhost:8000/api/files/${fileId}/execute_query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal,
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

/*
// Export query results to CSV
export async function exportQueryToCSV(token: string, fileId: string, query: string) {
  const response = await fetch(`http://localhost:8000/api/files/${fileId}/export_query_to_csv/`, {
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
    throw new Error(errorData.error || `CSV export failed: ${response.status} ${response.statusText}`);
  }

  // Return the blob for download
  return await response.blob();
}

*/