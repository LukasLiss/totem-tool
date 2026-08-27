import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Kept separate from vite.config.ts so a production `vite build` never
// needs vitest (a devDependency) present at config-load time. Only
// `vitest run` loads this file; it merges in the same plugins/aliases
// vite.config.ts already defines.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      passWithNoTests: true,
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/main.tsx",
          "src/vite-env.d.ts",
          "src/gridstack/**",
          "src/mocks/**",
        ],
      },
    },
  })
);
