function asOrigin(value: string): string {
  return value.includes("://") ? value : `https://${value}`;
}

export const API_BASE_URL = asOrigin(
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"
);
