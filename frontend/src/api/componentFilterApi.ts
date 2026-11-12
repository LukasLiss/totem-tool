import axios from "axios";

export async function getComponentFilters(
  projectId: number
): Promise<Record<string, Record<string, string>>> {
  const { data } = await axios.get<Record<string, Record<string, string>>>(
    `/api/projects/${projectId}/component-filters/`
  );
  return data;
}

export async function saveComponentFilter(
  projectId: number,
  componentKey: string,
  localFilterParams: Record<string, string>
): Promise<void> {
  await axios.put(`/api/projects/${projectId}/component-filters/`, {
    component_key: componentKey,
    local_filter_params: localFilterParams,
  });
}

/**
 * Store the local filter of the dashboard widget at grid position (x, y);
 * null clears it. Positions identify widgets because component ids change
 * with every dashboard save.
 */
export async function saveDashboardWidgetLocalFilter(
  dashboardId: number,
  x: number,
  y: number,
  localFilterParams: Record<string, string> | null
): Promise<void> {
  await axios.patch(`/api/dashboard/${dashboardId}/local_filter/`, {
    x,
    y,
    local_filter_params: localFilterParams,
  });
}
