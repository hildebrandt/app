import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), tailwindcss(), viteReact()],
  test: {
    ...sharedTestConfig,
    include: ["src/**/*.test.{ts,tsx}", "start.test.tsx"],
  },
});
