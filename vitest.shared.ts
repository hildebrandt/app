import type { TestUserConfig } from "vite-plus";

export const sharedTestConfig = {
  allowOnly: false,
  passWithNoTests: false,
  reporters: ["default", "junit", "json", "blob"],
  outputFile: {
    junit: "reports/test/junit.xml",
    json: "reports/test/results.json",
    blob: "coverage/blob/report.json",
  },
  coverage: {
    enabled: true,
    provider: "v8",
    reporter: ["text"],
    include: ["src/**/*.{ts,tsx}", "start.mjs"],
    exclude: ["src/routeTree.gen.ts", "src/route-tree.fixture.ts"],
  },
} satisfies TestUserConfig;
