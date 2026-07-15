import axios from "axios";

export interface Project {
  id: number;
  name: string;
  display_name: string;
  created_at: string;
}

interface ProjectListResponse {
  results: Project[];
}

const PROJECTS_URL = "http://localhost:8000/api/projects/";

export async function listProjects() {
  const { data } = await axios.get<Project[] | ProjectListResponse>(PROJECTS_URL);
  return Array.isArray(data) ? data : data.results;
}

export async function getProject(projectId: number) {
  const { data } = await axios.get<Project>(`${PROJECTS_URL}${projectId}/`);
  return data;
}

export async function createProject(name?: string) {
  const { data } = await axios.post<Project>(PROJECTS_URL, {
    ...(name !== undefined ? { name } : {}),
  });
  return data;
}

export async function renameProject(projectId: number, name: string) {
  const { data } = await axios.patch<Project>(`${PROJECTS_URL}${projectId}/`, {
    name,
  });
  return data;
}

export async function deleteUserData() {
  const { data } = await axios.delete("http://localhost:8000/api/delete-data/", {
    data: { confirm: "DELETE" },
  });
  return data;
}
