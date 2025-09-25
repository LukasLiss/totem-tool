import axios from "axios";

let refresh = false;

// Load token from localStorage on startup
const token = localStorage.getItem("access_token");
if (token) {
  axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
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
        // Refresh failed → force logout
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
