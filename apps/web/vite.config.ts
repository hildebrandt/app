import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), viteReact()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "start.test.tsx"],
    allowOnly: false,
    passWithNoTests: false,
  },
});
