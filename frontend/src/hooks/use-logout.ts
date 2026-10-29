import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

// Replace the current entry so that pressing Back after logging out doesn't
// return to the (now unauthenticated) page the user logged out from.
export function useLogout() {
  const navigate = useNavigate();
  return useCallback(() => navigate("/logout", { replace: true }), [navigate]);
}
