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

// Download an event log re-exported as a standard OCEL 2.0 JSON file and
// trigger a browser download.
export async function downloadOcelExport(
  fileId: number,
  filename = "event_log.json"
): Promise<void> {
  let blob: Blob;
  try {
    const response = await axios.get(
      `http://localhost:8000/api/files/${fileId}/export/`,
      { responseType: "blob" }
    );
    blob = response.data;
  } catch (e) {
    const msg = axios.isAxiosError(e)
      ? `Export failed: ${e.response?.status ?? e.message}`
      : "Export failed";
    throw new Error(msg);
  }

  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
