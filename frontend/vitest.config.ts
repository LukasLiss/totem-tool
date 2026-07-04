import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone vitest config: the engine tests are pure TypeScript, so the
// React/Tailwind plugins from vite.config.ts are intentionally not loaded.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
