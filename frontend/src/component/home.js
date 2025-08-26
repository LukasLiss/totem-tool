// Import the react JS packages
import { useEffect, useState } from "react";
import axios from "axios";

// Define the Home function.
export const Home = () => {
  const [message, setMessage] = useState('');

  useEffect(() => {
    // If no token, redirect to login
    if (localStorage.getItem('access_token') === null) {
      window.location.href = '/login';
    } else {
      (async () => {
        try {
          const { data } = await axios.get(
            'http://localhost:8000/home/',
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('access_token')}`,
              },
              withCredentials: true,
            }
          );
          setMessage(data.message);
        } catch (e) {
          console.error('Not authenticated:', e);
          window.location.href = '/login';
        }
      })();
    }
  }, []);

  return (
    <div className="form-signin mt-5 text-center">
      <h3>Hi {message}</h3>
    </div>
  );
};
