import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    allowOnly: false,
    environment: "node",
    include: ["start.test.mjs"],
    passWithNoTests: false,
  },
});
