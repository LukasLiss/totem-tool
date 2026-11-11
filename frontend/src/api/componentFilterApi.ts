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

export async function patchDashboardComponentLocalFilter(
  dashboardId: number,
  componentId: number,
  localFilterParams: Record<string, string> | null
): Promise<void> {
  await axios.patch(
    `/api/dashboard/${dashboardId}/components/${componentId}/local-filter/`,
    { local_filter_params: localFilterParams }
  );
}
