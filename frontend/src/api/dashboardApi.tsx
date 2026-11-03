import axios from "axios";

export async function addDashboard(dashboardName: string, projectId: number) {
  const { data } = await axios.post("/api/dashboard/", {
    name: dashboardName,
    project: projectId,
  });
  return data;
}

export async function renameDashboard(dashboardId: number, newName: string) {
  const { data } = await axios.patch(
    `/api/dashboard/${dashboardId}/rename/`,
    { name: newName }
  );
  return data;
}

export async function getDashboards(projectId?: number) {
  const url = projectId
    ? `/api/dashboard/?project=${projectId}`
    : "/api/dashboard/";
  const { data } = await axios.get(url);
  return data;
}

export async function deleteDashboard(dashboardId: number) {
  await axios.delete(`/api/dashboard/${dashboardId}/`);
  return true;
}

/**
 * Store the layout options of the OC-DFG widget at grid position (x, y)
 * while the dashboard is viewed; null resets it to the default layout.
 */
export async function saveOcdfgWidgetLayout(
  dashboardId: number,
  x: number,
  y: number,
  layoutOptions: unknown,
): Promise<void> {
  await axios.patch(`/api/dashboard/${dashboardId}/ocdfg_layout/`, { x, y, layout_options: layoutOptions });
}
