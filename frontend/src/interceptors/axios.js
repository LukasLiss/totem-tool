import axios from "axios";

/**
 * Token refresh strategy
 * ----------------------
 * SimpleJWT issues short-lived access tokens (configured in
 * backend/totem_backend/settings.py — 20 min in normal mode, 8 h in
 * LOCAL_MODE) and longer-lived refresh tokens. When an access token
 * expires while the app is idle, the next API call returns 401. This
 * response interceptor:
 *
 *   1. Posts the refresh token to /token/refresh/ to get a new access
 *      token (and rotated refresh, since ROTATE_REFRESH_TOKENS=True),
 *   2. Retries the original request with the new access token.
 *
 * Concurrency: when the dashboard loads after idle, several endpoints
 * fire at once and all 401 simultaneously. We track the in-flight
 * refresh as a single shared Promise so concurrent failures wait on it
 * and then retry, rather than the previous behaviour of letting all but
 * the first one fail outright.
 */

// Load access token from localStorage on startup. Guard against literal
// "null"/"undefined" strings — those can leak in if some other code path
// writes them and would otherwise produce a malformed `Bearer null` header
// that the backend rejects.
function setAuthHeaderFromStorage() {
  const t = localStorage.getItem("access_token");
  if (t && t !== "null" && t !== "undefined") {
    axios.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  } else {
    delete axios.defaults.headers.common["Authorization"];
  }
}
setAuthHeaderFromStorage();

// Shared in-flight refresh promise. While non-null, concurrent 401s await
// it and then retry the original request with the new access token.
let refreshInFlight = null;

async function performRefresh() {
  // Note the field name: SimpleJWT's TokenRefreshSerializer expects the
  // key `refresh`, NOT `refresh_token`. The previous code sent the wrong
  // key and Django responded 400 → interceptor cleared storage → user
  // redirected to /login every time their access token expired.
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken || refreshToken === "null" || refreshToken === "undefined") {
    throw new Error("No refresh token available");
  }
  const response = await axios.post(
    "http://localhost:8000/token/refresh/",
    { refresh: refreshToken },
    {
      headers: { "Content-Type": "application/json" },
      withCredentials: true,
      // Bypass the response interceptor — a 401 from the refresh endpoint
      // itself must NOT trigger another refresh attempt.
      _skipAuthRefresh: true,
    }
  );
  const newAccess = response.data.access;
  axios.defaults.headers.common["Authorization"] = `Bearer ${newAccess}`;
  localStorage.setItem("access_token", newAccess);
  if (response.data.refresh) {
    // ROTATE_REFRESH_TOKENS=True on the backend — store the rotated one.
    localStorage.setItem("refresh_token", response.data.refresh);
  }
  return newAccess;
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
    const cfg = error.config || {};
    // Only handle 401s, and never recurse on the refresh call itself.
    if (
      !error.response ||
      error.response.status !== 401 ||
      cfg._skipAuthRefresh ||
      cfg._retried
    ) {
      return Promise.reject(error);
    }

    // Mark the failed request so we don't retry it more than once.
    cfg._retried = true;

    // Coalesce concurrent refreshes: only one /token/refresh/ in flight.
    if (!refreshInFlight) {
      refreshInFlight = performRefresh().finally(() => {
        refreshInFlight = null;
      });
    }

    try {
      const newAccess = await refreshInFlight;
      cfg.headers = cfg.headers || {};
      cfg.headers["Authorization"] = `Bearer ${newAccess}`;
      return axios(cfg);
    } catch (refreshError) {
      if (import.meta.env.VITE_LOCAL_MODE) {
        // Local mode: silently re-authenticate as Guest instead of redirecting.
        try {
          const newAccess = await guestReAuth();
          cfg.headers = cfg.headers || {};
          cfg.headers["Authorization"] = `Bearer ${newAccess}`;
          return axios(cfg);
        } catch {
          return Promise.reject(refreshError);
        }
      }
      // Normal mode: refresh token is gone or itself expired — force logout.
      localStorage.clear();
      delete axios.defaults.headers.common["Authorization"];
      window.location.href = "/login";
      return Promise.reject(refreshError);
    }
  }
);
