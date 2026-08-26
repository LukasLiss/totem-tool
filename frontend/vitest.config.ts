import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone vitest config: the unit tests are pure TypeScript, so the
// React/Tailwind plugins from vite.config.ts are intentionally not loaded.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/vite-env.d.ts", "src/gridstack/**", "src/mocks/**"],
    },
  },
});
