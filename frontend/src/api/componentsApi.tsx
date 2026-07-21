import axios from "axios";
import { API_BASE_URL } from "@/config/apiBaseUrl";

export async function saveLayout(dashboardId: number, layout: object) {
  const { data } = await axios.post(
    `${API_BASE_URL}/api/dashboard/${dashboardId}/save_layout/`,
    { layout }
  );
  return data;
}

export async function getLayout(dashboardId: number) {
  const { data } = await axios.get(
    `${API_BASE_URL}/api/dashboard/${dashboardId}/get_layout/`
  );
  return data;
}

export async function uploadImageToComponent(
  dashboardId: number,
  componentId: number,
  file: File
) {
  const formData = new FormData();
  formData.append("image", file);
  const { data } = await axios.post(
    `/api/dashboard/${dashboardId}/components/${componentId}/image/`,
    formData
  );
  return data;
}
