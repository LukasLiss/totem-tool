import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

/**
 * Landing page for the backend's OAuth callback redirect.
 *
 * The backend puts the JWT pair in the URL fragment
 * (`/oauth/callback#access=…&refresh=…&next=/upload`). We store the tokens
 * the same way the password login does, wipe the fragment from history so
 * the tokens don't linger in the address bar, and continue to `next`.
 */
export const OAuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const access = params.get("access");
    const refresh = params.get("refresh");
    const next = params.get("next");
    window.history.replaceState(null, "", window.location.pathname);

    if (!access || !refresh) {
      navigate("/login?oauth_error=missing_tokens", { replace: true });
      return;
    }

    localStorage.clear();
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
    axios.defaults.headers.common["Authorization"] = `Bearer ${access}`;

    const safeNext =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/upload";
    navigate(safeNext, { replace: true });
  }, [navigate]);

  return null;
};
