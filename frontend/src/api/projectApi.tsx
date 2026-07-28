import axios from "axios";

export async function deleteUserData() {
  const { data } = await axios.delete("http://localhost:8000/api/delete-data/", {
    data: { confirm: "DELETE" },
  });
  return data;
}
