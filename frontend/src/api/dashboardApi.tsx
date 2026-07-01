import axios from "axios";

export async function addDashboard(dashboardName: string, projectId: number) {
  const { data } = await axios.post("http://localhost:8000/api/dashboard/", {
    name: dashboardName,
    project: projectId,
  });
  return data;
}

export async function renameDashboard(dashboardId: number, newName: string) {
  const { data } = await axios.patch(
    `http://localhost:8000/api/dashboard/${dashboardId}/rename/`,
    { name: newName }
  );
  return data;
}

export async function getDashboards(projectId?: number) {
  const url = projectId
    ? `http://localhost:8000/api/dashboard/?project=${projectId}`
    : "http://localhost:8000/api/dashboard/";
  const { data } = await axios.get(url);
  return data;
}

export async function deleteDashboard(dashboardId: number) {
  await axios.delete(`http://localhost:8000/api/dashboard/${dashboardId}/`);
  return true;
}
