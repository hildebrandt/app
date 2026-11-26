import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  server: {
    port: 3001,
  },
  test: {
    ...sharedTestConfig,
    include: ["src/**/*.test.{ts,tsx}", "start.test.tsx"],
  },
  plugins: [tanstackStart(), viteReact()],
});
