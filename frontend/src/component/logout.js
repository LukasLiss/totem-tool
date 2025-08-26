import { useEffect, useState } from "react";
import axios from "axios";
//import {RefreshToken} from "rest_framework_simplejwt.tokens";

export const Logout = () => {
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.post(
          'http://localhost:8000/logout/',
          {
            refresh_token: localStorage.getItem('refresh_token')
          },
          { headers: { 'Content-Type': 'application/json' } },
          { withCredentials: true }
        );

        localStorage.clear();
        axios.defaults.headers.common['Authorization'] = null;
        window.location.href = '/login';
      } catch (e) {
        console.log('logout not working', e);
      }
    })();
  }, []);

  return (
    <div></div>
  );
};
