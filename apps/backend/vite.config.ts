import path from "node:path";

import { defineConfig } from "vite-plus";

import { sharedTestConfig } from "../../vitest.shared.js";

const startEntry = path.resolve(import.meta.dirname, "start.mjs");

export default defineConfig({
  build: {
    ssr: true,
    target: "node24",
    outDir: "dist",
    rolldownOptions: {
      input: { start: startEntry },
      output: {
        entryFileNames: "[name].mjs",
      },
    },
  },
  test: {
    ...sharedTestConfig,
    environment: "node",
    include: ["start.test.mjs"],
  },
});
