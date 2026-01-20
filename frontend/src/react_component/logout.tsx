import { useEffect } from "react";

export const Logout = () => {
  useEffect(() => {
    const logout = async () => {
      try {
        await fetch('http://localhost:8000/logout/', {
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
        //window.location.href = '/upload';
      } catch (e) {
        console.log('logout not working', e);
      }
    };

    logout();
  }, []);

  return null;
};
