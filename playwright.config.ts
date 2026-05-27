import { defineConfig, devices } from "@playwright/test";

/**
 * Relations v0.2 E2E Tests — Playwright config
 *
 * Assumes:
 * - Backend running on http://localhost:7330 (npm run dev --workspace=@sanctom/relations)
 * - Frontend running on http://localhost:5733 (npm run dev --workspace=@sanctom/relations-ui)
 *
 * Run all tests:
 *   npx playwright test
 *
 * Run specific test file:
 *   npx playwright test packages/ui/e2e/investor-kanban.spec.ts
 *
 * Debug mode (headed browser, step through):
 *   npx playwright test --debug
 *
 * UI mode (interactive):
 *   npx playwright test --ui
 */

export default defineConfig({
  testDir: "packages/ui/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: "html",

  use: {
    baseURL: "http://localhost:5733",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  webServer: {
    command: "npm run dev --workspaces",
    url: "http://localhost:5733",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
