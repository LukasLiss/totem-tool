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

/** The schema/version stamp every exported dashboard file carries. */
export const DASHBOARD_BUNDLE_SCHEMA = "totem-dashboard";
export const DASHBOARD_BUNDLE_VERSION = 1;

/** Something an import could not carry over, for the user to act on. */
export interface DashboardImportWarning {
  code: string;
  component_name: string | null;
  detail: string;
}

export interface DashboardImportResult {
  dashboard: { id: number; name: string; project: number };
  warnings: DashboardImportWarning[];
}

/** The dashboard's structure as a portable document, ready to write to disk. */
export async function exportDashboard(dashboardId: number) {
  const { data } = await axios.get(`/api/dashboard/${dashboardId}/export/`);
  return data;
}

/**
 * Create a new dashboard in `projectId` from an exported bundle. Never
 * overwrites: a name clash is resolved server-side by suffixing.
 *
 * `eventLogId` is what dotted charts get re-pointed at; pass null when no log
 * is selected and they import unbound.
 */
export async function importDashboard(
  projectId: number,
  eventLogId: number | null,
  bundle: unknown
): Promise<DashboardImportResult> {
  const { data } = await axios.post("/api/dashboard/import/", {
    project: projectId,
    event_log: eventLogId,
    bundle,
  });
  return data;
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
