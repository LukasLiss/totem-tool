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
    window.location.href = '/login';
    return;
  }
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload failed: ${response.status} ${response.statusText}\n${err}`);
  }

  return await response.json();
}

// Fetch the list of files for the logged-in user
export async function getDashboards(token: string, projectId?: number) {
  const url = projectId
    ? `http://localhost:8000/api/dashboard/?project=${projectId}`
    : "http://localhost:8000/api/dashboard/";

    console.log("Requesting dashboards from:", url);
  const response = await fetch("http://localhost:8000/api/dashboard/", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
   if (response.status === 401) {
    console.log('401: authentification')
    window.location.href = '/login';
    return;
  }

  if (!response.ok) {
    throw new Error(`Fetching files failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}


// Dummy fetch to test if OPTIONS + Authorization work
export async function testOptions(token) {
  const response = await fetch("http://localhost:8000/api/dashboard/", {
    method: "OPTIONS",   // 👈 force preflight request
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  console.log("Status:", response.status);
  console.log("Headers:", [...response.headers.entries()]);
  console.log("Body:", await response.text());
}

