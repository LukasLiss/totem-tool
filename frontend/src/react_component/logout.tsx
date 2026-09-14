import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";

export const Logout = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const logout = async () => {
      const refresh = localStorage.getItem("refresh_token");
      try {
        // Blacklist the refresh token server-side. The endpoint requires an
        // authenticated request, so go through axios (which carries the
        // Bearer header) instead of a bare fetch.
        if (refresh) {
          await axios.post(
            "/logout/",
            { refresh_token: refresh },
            { _skipAuthRefresh: true, _skipGlobalFilter: true }
          );
        }
      } catch {
        // Token may already be expired/blacklisted — still log out locally.
      } finally {
        localStorage.clear();
        delete axios.defaults.headers.common["Authorization"];
        toast.success("Logged out");
        navigate("/title", { replace: true });
      }
    };

    logout();
  }, [navigate]);

  return null;
};
