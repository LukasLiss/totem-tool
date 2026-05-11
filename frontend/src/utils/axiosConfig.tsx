import axios from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:8000',
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    original._retry = true;

    try {
      if (!refreshing) {
        refreshing = (async () => {
          const refresh = localStorage.getItem('refresh_token');
          if (!refresh) throw new Error('NO_REFRESH');
          const res = await axios.post('http://localhost:8000/token/refresh/', { refresh });
          const newAccess: string = res.data.access;
          localStorage.setItem('access_token', newAccess);
          if (res.data.refresh) {
            localStorage.setItem('refresh_token', res.data.refresh);
          }
          return newAccess;
        })().finally(() => { refreshing = null; });
      }
      const newAccess = await refreshing;
      original.headers.Authorization = `Bearer ${newAccess}`;
      return api(original);
    } catch {
      localStorage.clear();
      const currentPath = window.location.pathname;
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      return Promise.reject(error);
    }
  }
);