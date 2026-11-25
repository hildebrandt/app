import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const routeTreeFixture = fileURLToPath(
  new URL("src/route-tree.fixture.ts", import.meta.url)
);

export default defineConfig({
  plugins: [tanstackStart(), viteReact()],
  resolve: {
    alias: {
      "./routeTree.gen": routeTreeFixture,
    },
  },
  test: {
    allowOnly: false,
    include: ["src/**/*.test.{ts,tsx}", "start.test.tsx"],
    passWithNoTests: false,
    env: { PORT: "0" },
  },
});
