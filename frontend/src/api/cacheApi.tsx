import axios from "axios";

export async function getCacheStats() {
  const { data } = await axios.get("/api/cache/stats/");
  return data;
}

export async function clearCache() {
  const { data } = await axios.post("/api/cache/clear/");
  return data;
}
