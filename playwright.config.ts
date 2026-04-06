import { defineConfig, devices } from "@playwright/test";
import {
  createPlaywrightWebServerEnv,
  getPlaywrightBaseUrl,
} from "./tests/setup/playwright-env";

const baseURL = getPlaywrightBaseUrl();
const webServerHealthUrl = new URL("/api/health", baseURL).toString();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  globalSetup: "./tests/setup/playwright-global-setup.ts",
  use: {
    baseURL,
      trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev -- --hostname localhost --port 3001",
        env: createPlaywrightWebServerEnv(),
        url: webServerHealthUrl,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
