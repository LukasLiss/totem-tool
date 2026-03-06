import { Navigate, useLocation } from "react-router-dom";


export async function saveLayout(dashboardId: number, layout: object, token: string) {
    const response = await fetch(`http://localhost:8000/api/dashboard/${dashboardId}/save_layout/`, {
    method: "POST",
    headers: { 
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" },
    body: JSON.stringify({ layout })
  });
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }
    
  return await response.json();
  }



export async function getLayout(dashboardId: number, token: string) {
  const response = await fetch(`http://localhost:8000/api/dashboard/${dashboardId}/get_layout/`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
   if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    throw new Error(`Fetching layout failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

export async function uploadImageToComponent(
  dashboardId: number,
  componentId: number,
  file: File,
  token: string
) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(
    `/api/dashboard/${dashboardId}/components/${componentId}/image/`,  // Updated URL to match backend
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error("Upload failed:", response.status, text);
    throw new Error(`Image upload failed (${response.status})`);
  }
  const data = await response.json();
  return data;
}