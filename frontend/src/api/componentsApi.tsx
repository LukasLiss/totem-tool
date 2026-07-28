import axios from "axios";

export async function saveLayout(dashboardId: number, layout: object) {
  const { data } = await axios.post(
    `http://localhost:8000/api/dashboard/${dashboardId}/save_layout/`,
    { layout }
  );
  return data;
}

export async function getLayout(dashboardId: number) {
  const { data } = await axios.get(
    `http://localhost:8000/api/dashboard/${dashboardId}/get_layout/`
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
