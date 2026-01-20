// Add a dashboard for the logged-in user
export async function addDashboard(dashboardName: string, projectId: number, token: string) {
  const response = await fetch("http://localhost:8000/api/dashboard/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: dashboardName,
      project: projectId
    }),
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload failed: ${response.status} ${response.statusText}\n${err}`);
  }

  return await response.json();
}

export async function renameDashboard(dashboardId: number, newName: string, token: string) {
  const response = await fetch(`http://localhost:8000/api/dashboard/${dashboardId}/rename/`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: newName }),
  });
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Rename failed: ${response.status} ${response.statusText}\n${err}`);
  }

  return await response.json();
}


export async function getDashboards(token: string, projectId?: number) {
  const url = projectId
    ? `http://localhost:8000/api/dashboard/?project=${projectId}`
    : "http://localhost:8000/api/dashboard/";

  console.log("Requesting dashboards from:", url);
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  if (!response.ok) {
    throw new Error(
      `Fetching dashboards failed: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}


export async function deleteDashboard(dashboardId: number, token: string) {
  const response = await fetch(`http://localhost:8000/api/dashboard/${dashboardId}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Delete failed: ${response.status} ${response.statusText}\n${err}`);
  }

  return true;
}