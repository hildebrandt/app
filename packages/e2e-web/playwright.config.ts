import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const isCI = process.env.CI === "true" || process.env.CI === "1";

const hasBaseURL =
  process.env.PLAYWRIGHT_BASE_URL !== undefined &&
  process.env.PLAYWRIGHT_BASE_URL !== "";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "reports/playwright/results.json" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "on",
  },
  webServer: hasBaseURL
    ? undefined
    : {
      command: "node start.mjs",
      cwd: fileURLToPath(new URL("../../apps/web", import.meta.url)),
      env: { PORT: new URL(baseURL).port },
      reuseExistingServer: !isCI,
      timeout: 120_000,
      url: baseURL,
    },
});
