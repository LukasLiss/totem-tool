import { useEffect } from "react";
import axios from "axios";
//import {RefreshToken} from "rest_framework_simplejwt.tokens";

export const Logout = () => {
  useEffect(() => {
    (async () => {
      try {

        localStorage.clear();
        axios.defaults.headers.common['Authorization'] = null;
        window.location.href = '/upload';
      } catch (e) {
        console.log('logout not working', e);
      }
    })();
  }, []);

  return (
    <div></div>
  );
};
