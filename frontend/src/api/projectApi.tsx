import axios from "axios";

export async function deleteUserData() {
  const { data } = await axios.delete("/api/delete-data/", {
    data: { confirm: "DELETE" },
  });
  return data;
}
