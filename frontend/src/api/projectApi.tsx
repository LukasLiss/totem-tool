import axios from "axios";

export async function deleteUserData() {
  const { data } = await axios.delete("/api/delete-data/", {
    data: { confirm: "DELETE" },
  });
  return data;
}

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
