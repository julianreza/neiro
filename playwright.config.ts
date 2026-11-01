import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://localhost:3210", browserName: "chromium" },
  webServer: {
    command: "bun run dev --port 3210",
    url: "http://localhost:3210/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { NEIRO_E2E: "1", DASHBOARD_SECRET: "test-only-passcode", NEIRO_LOCAL_TICK: "off" },
  },
});
