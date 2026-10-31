import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3210", browserName: "chromium" },
  webServer: {
    command: "bun run dev --port 3210",
    url: "http://127.0.0.1:3210/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { DASHBOARD_SECRET: "test-only-passcode", NEIRO_LOCAL_TICK: "off" },
  },
});
