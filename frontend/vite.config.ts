import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: "/",
  plugins: [react(), tailwindcss()],
  define: {
    // Shown in Settings; keep the frontend version in sync with the release.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: {
    // Several components log on every render; keep production bundles quiet.
    drop: command === "build" ? ["console", "debugger"] : [],
  },
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
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("error", (err) => {
            if ((err as NodeJS.ErrnoException).code === "ECONNRESET") {
              return;
            }
            console.warn("[vite-proxy] Proxy error:", err.message);
          });
        },
      },
    },
  },
}));

// Prevent unhandled ECONNRESET/EPIPE errors from terminating the dev server
// when clients (or proxies) abruptly disconnect on Windows/Node.js 24.
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "ECONNRESET" || err.code === "EPIPE") {
    return;
  }
  console.error("Uncaught exception:", err);
  process.exit(1);
});
