import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
//
// Deliberately imports `defineConfig` from "vite", not "vitest/config" —
// this file is loaded by every `vite build`/`vite dev`, including
// production builds that may install with --omit=dev (vitest and its
// plugins are devDependencies). Test-only config lives in
// vitest.config.ts instead, which merges this file in and is only ever
// loaded by `vitest run`.
export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      // forward all /api/* to Django on :8000
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
