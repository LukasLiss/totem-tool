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

