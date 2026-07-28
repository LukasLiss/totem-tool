import axios from "axios";

export async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await axios.post("http://localhost:8000/api/files/", formData);
  return data;
}

export async function getUserFiles() {
  const { data } = await axios.get("http://localhost:8000/api/files/");
  return data;
}

export async function processFile(fileId: string | number) {
  const { data } = await axios.get(`http://localhost:8000/api/files/${fileId}/NoE/`);
  return data;
}
