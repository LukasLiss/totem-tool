import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests (see e2e/README.md).
 *
 * They run against the real app in desktop/local mode: Django on :8000 with
 * LOCAL_MODE=1 and Vite on :3000 with VITE_LOCAL_MODE=1. Servers that are
 * already running are reused; otherwise Playwright starts them (the backend
 * from backend/.venv).
 */
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const BACKEND_PYTHON = process.env.E2E_BACKEND_PYTHON || "../backend/.venv/bin/python";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // PW_CHANNEL=chrome uses the installed Google Chrome instead of Playwright's own build.
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: `LOCAL_MODE=1 ${BACKEND_PYTHON} ../backend/manage.py runserver 8000 --noreload`,
          url: "http://127.0.0.1:8000/api/",
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "VITE_LOCAL_MODE=1 npx vite --port 3000 --strictPort --open false",
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
