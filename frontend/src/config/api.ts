/**
 * Global API configuration.
 *
 * In cloud hosting (e.g. Vercel), set VITE_API_URL or VITE_BACKEND_URL to the
 * deployed Railway backend URL (e.g. https://your-railway-app.up.railway.app).
 *
 * In local development, if neither is set, it defaults to http://localhost:8000.
 */
export const API_BASE_URL: string = (
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  'http://localhost:8000'
).replace(/\/$/, '');

export const getApiUrl = (path: string): string => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
};

export default API_BASE_URL;
