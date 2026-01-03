
export async function saveLayout(dashboardId: number, layout: object, token: string) {
    const response = await fetch(`http://localhost:8000/api/dashboard/${dashboardId}/save_layout/`, {
    method: "POST",
    headers: { 
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" },
    body: JSON.stringify({ layout })
  });
    return response.json();
  }



export async function getLayout(dashboardId: number, token: string) {
  const response = await fetch(`http://localhost:8000/api/dashboard/${dashboardId}/get_layout/`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
   if (response.status === 401) {
    throw new Error('Authentication failed');
  }

  if (!response.ok) {
    throw new Error(`Fetching layout failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}