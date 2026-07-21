import { useEffect } from "react";
import { toast } from "sonner";
import { API_BASE_URL } from "@/config/apiBaseUrl";

export const Logout = () => {
  useEffect(() => {
    const logout = async () => {
      try {
        await fetch(`${API_BASE_URL}/logout/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // equivalent to axios withCredentials: true
          body: JSON.stringify({
            refresh_token: localStorage.getItem('refresh_token'),
          }),
        });

        // Clear tokens regardless of backend response
        localStorage.clear();

        // Redirect
        toast.success('Logged out successfully');
        window.location.href = '/title';
      } catch (e) {
        console.log('logout not working', e);
      }
    };

    logout();
  }, []);

  return null;
};
