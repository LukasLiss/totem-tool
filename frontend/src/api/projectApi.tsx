import axios from "axios";
import { API_BASE_URL } from "@/config/apiBaseUrl";

export async function deleteUserData() {
  const { data } = await axios.delete(`${API_BASE_URL}/api/delete-data/`, {
    data: { confirm: "DELETE" },
  });
  return data;
}
