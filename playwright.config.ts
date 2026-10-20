import { defineConfig, devices } from "playwright/test";

const E2E_ADMIN_BYPASS_TOKEN = "oilpick-playwright-admin";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    extraHTTPHeaders: { "x-oilpick-e2e-admin": E2E_ADMIN_BYPASS_TOKEN },
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm exec next dev --webpack --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    env: { E2E_ADMIN_BYPASS_TOKEN, NEXT_DIST_DIR: ".next-e2e" },
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
