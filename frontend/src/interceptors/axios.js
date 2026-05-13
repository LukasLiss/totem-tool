import axios from "axios";

let refresh = false;

// Load token from localStorage on startup
const token = localStorage.getItem("access_token");
if (token) {
  axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
}

async function guestReAuth() {
  const resp = await axios.post(
    "http://localhost:8000/token/",
    { username: "Guest", password: "guest" },
    { headers: { "Content-Type": "application/json" } }
  );
  const { access, refresh: newRefresh } = resp.data;
  axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;
  localStorage.setItem("access_token", access);
  if (newRefresh) localStorage.setItem("refresh_token", newRefresh);
  return access;
}

axios.interceptors.response.use(
  (resp) => resp,
  async (error) => {
    if (error.response && error.response.status === 401 && !refresh) {
      refresh = true;

      try {
        const response = await axios.post(
          "http://localhost:8000/token/refresh/",
          { refresh_token: localStorage.getItem("refresh_token") },
          {
            headers: { "Content-Type": "application/json" },
            withCredentials: true,
          }
        );

        if (response.status === 200) {
          const newAccess = response.data.access;
          axios.defaults.headers.common[
            "Authorization"
          ] = `Bearer ${newAccess}`;
          localStorage.setItem("access_token", newAccess);

          if (response.data.refresh) {
            localStorage.setItem("refresh_token", response.data.refresh);
          }

          // retry the original request
          return axios(error.config);
        }
      } catch (refreshError) {
        if (import.meta.env.VITE_LOCAL_MODE) {
          // Local mode: silently re-authenticate as Guest instead of redirecting
          try {
            await guestReAuth();
            return axios(error.config);
          } catch {
            // Guest re-auth also failed — nothing we can do
            return Promise.reject(refreshError);
          }
        }
        // Normal mode: force logout
        localStorage.clear();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        refresh = false;
      }
    }

    return Promise.reject(error);
  }
);
