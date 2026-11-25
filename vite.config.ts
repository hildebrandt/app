import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 80,
  },
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "react"],
    categories: {
      correctness: "error",
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
    },
    overrides: [
      {
        files: ["apps/web/**", "apps/docs/**"],
        plugins: ["nextjs"],
      },
    ],
    ignorePatterns: [
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/dist/**",
      "**/coverage/**",
      "**/next-env.d.ts",
    ],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    // The repository has no test files yet. Remove this when tests are added.
    passWithNoTests: true,
  },
});
