export interface Dashboard {
  id: number;
  name: string;
  project: number;
  order_in_project: number;
  created_at: string;
}

export interface BaseComponent {
  id: number;
  dashboard: number;
  x: number;
  y: number;
  width: number;
  height: number;
  component_type: string;
}

export interface TextBoxComponent extends BaseComponent {
  text: string;
  font_size: number;
}

export interface NumberOfEventsComponent extends BaseComponent {
  color: string;
}

const API_BASE = "http://localhost:8000/api";

export async function fetchDashboards(): Promise<Dashboard[]> {
  const res = await fetch(`${API_BASE}/dashboards/`);
  if (!res.ok) throw new Error("Failed to load dashboards");
  return res.json();
}

export async function fetchComponents(dashboardId: number): Promise<BaseComponent[]> {
  const res = await fetch(`${API_BASE}/components/?dashboard=${dashboardId}`);
  if (!res.ok) throw new Error("Failed to load components");
  return res.json();
}

export async function createComponent(data: Partial<BaseComponent>): Promise<BaseComponent> {
  const res = await fetch(`${API_BASE}/components/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create component");
  return res.json();
}

export async function updateComponent(id: number, data: Partial<BaseComponent>): Promise<BaseComponent> {
  const res = await fetch(`${API_BASE}/components/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update component");
  return res.json();
}

export async function deleteComponent(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/components/${id}/`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete component");
}
