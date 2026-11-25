import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    port: 3001,
  },
  test: {
    allowOnly: false,
    include: ["src/**/*.test.{ts,tsx}", "start.test.tsx"],
    passWithNoTests: false,
  },
  plugins: [tanstackStart(), viteReact()],
});
