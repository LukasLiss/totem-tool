import { Navigate, useLocation } from "react-router-dom";
import { API_BASE_URL } from "./config";


export async function saveLayout(dashboardId: number, layout: object, token: string) {
  const response = await fetch(`${API_BASE_URL}/api/dashboard/${dashboardId}/save_layout/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
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
  const response = await fetch(`${API_BASE_URL}/api/dashboard/${dashboardId}/get_layout/`, {
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
  componentId: number,
  file: File,
  token: string
) {

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch(
    `${API_BASE_URL}/api/dashboard-components/${componentId}/upload_image/`,
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
    let errorMessage = `Image upload failed (${response.status})`; // Initialized errorMessage

    try {
      const errorData = JSON.parse(text); // Use JSON.parse on text we already awaited
      errorMessage = errorData?.error ?? errorMessage;
    } catch {
      // response was not JSON, keep default message
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data;
}