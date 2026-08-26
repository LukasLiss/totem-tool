import axios from "axios";

export async function getCacheStats() {
  const { data } = await axios.get("http://localhost:8000/api/cache/stats/");
  return data;
}

export async function clearCache() {
  const { data } = await axios.post("http://localhost:8000/api/cache/clear/");
  return data;
}
