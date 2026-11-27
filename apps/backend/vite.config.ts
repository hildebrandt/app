import { defineConfig } from "vite-plus";

import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  test: {
    ...sharedTestConfig,
    environment: "node",
    include: ["start.test.mjs"],
  },
});
