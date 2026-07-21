import axios from "axios";
import { API_BASE_URL } from "@/config/apiBaseUrl";

export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await axios.post(`${API_BASE_URL}/api/files/`, formData);
  return data;
}

export async function getUserFiles() {
  const { data } = await axios.get(`${API_BASE_URL}/api/files/`);
  return data;
}

export async function processFile(fileId: string | number) {
  const { data } = await axios.get(`${API_BASE_URL}/api/files/${fileId}/NoE/`);
  return data;
}
