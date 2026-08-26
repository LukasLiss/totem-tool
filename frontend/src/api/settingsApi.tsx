import axios from "axios";

export interface UserSettings {
  bypass_cache: boolean;
}

export async function getUserSettings(): Promise<UserSettings> {
  const { data } = await axios.get("http://localhost:8000/api/settings/");
  return data;
}

export async function updateUserSettings(
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const { data } = await axios.patch("http://localhost:8000/api/settings/", patch);
  return data;
}
