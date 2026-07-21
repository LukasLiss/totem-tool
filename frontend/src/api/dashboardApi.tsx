import axios from "axios";
import { API_BASE_URL } from "@/config/apiBaseUrl";

export async function addDashboard(dashboardName: string, projectId: number) {
  const { data } = await axios.post(`${API_BASE_URL}/api/dashboard/`, {
    name: dashboardName,
    project: projectId,
  });
  return data;
}

export async function renameDashboard(dashboardId: number, newName: string) {
  const { data } = await axios.patch(
    `${API_BASE_URL}/api/dashboard/${dashboardId}/rename/`,
    { name: newName }
  );
  return data;
}

export async function getDashboards(projectId?: number) {
  const url = projectId
    ? `${API_BASE_URL}/api/dashboard/?project=${projectId}`
    : `${API_BASE_URL}/api/dashboard/`;
  const { data } = await axios.get(url);
  return data;
}

export async function deleteDashboard(dashboardId: number) {
  await axios.delete(`${API_BASE_URL}/api/dashboard/${dashboardId}/`);
  return true;
}
