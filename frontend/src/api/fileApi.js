export async function uploadFile(file, token) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("http://localhost:8000/api/files/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  return response.json();
}

export async function getUserFiles(token) {
  const response = await fetch("http://localhost:8000/api/files/", {
    headers: { Authorization: `Bearer ${token}` }
  });

  return response.json();
}

