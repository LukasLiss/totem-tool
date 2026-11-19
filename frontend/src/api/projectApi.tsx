import axios from "axios";

export async function deleteUserData() {
  const { data } = await axios.delete("/api/delete-data/", {
    data: { confirm: "DELETE" },
  });
  return data;
}

/**
 * View-settings key holding the project's global filter, as
 * `{ rules: FilterRule[] }`. Must match `GLOBAL_FILTER_KEY` in
 * `backend/api/project_bundle.py`, which validates it on import.
 *
 * An object rather than a bare array because the backend refuses a view
 * setting that is not a JSON object.
 */
export const GLOBAL_FILTER_KEY = "global-filter";

/** One entry of a project's view settings; null when nothing is stored. */
export async function getProjectViewSetting(projectId: number, key: string): Promise<unknown> {
  const { data } = await axios.get(`/api/projects/${projectId}/view-settings/${key}/`, {
    _skipGlobalFilter: true,
  });
  return data?.value ?? null;
}

/** Store (or, with null, remove) one entry of a project's view settings. */
export async function putProjectViewSetting(projectId: number, key: string, value: unknown): Promise<void> {
  await axios.put(`/api/projects/${projectId}/view-settings/${key}/`, { value }, { _skipGlobalFilter: true });
}
