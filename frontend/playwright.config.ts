import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3012",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 3012 --strictPort",
    url: "http://localhost:3012",
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: "http://127.0.0.1:4010" },
  },
});
