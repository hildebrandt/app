import { defineConfig as defineOxfmtConfig } from "oxfmt";
import { defineConfig as defineOxlintConfig } from "oxlint";
import ultracite from "ultracite/oxfmt";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import tanstackJsPlugins from "ultracite/oxlint/tanstack/js-plugins";
import vitest from "ultracite/oxlint/vitest";
import { defineConfig } from "vite-plus";

const jsPlugins = selectJsPlugins(["sonarjs", "react-doctor"]);

const formatConfig = defineOxfmtConfig({
  ...ultracite,
  ignorePatterns: [...ultracite.ignorePatterns, "**/*.md"],
});

const lintConfig = defineOxlintConfig({
  env: core.env,
  extends: [core, react, tanstack, vitest, jsPlugins, tanstackJsPlugins],
  categories: { correctness: "error" },
  ignorePatterns: core.ignorePatterns,
  jsPlugins: [
    ...jsPlugins.jsPlugins,
    { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
  ],
  options: { typeAware: true, typeCheck: true },
  rules: {
    // Carried over from the previous Vite+ lint config.
    "vite-plus/prefer-vite-plus-imports": "error",
  },
  settings: jsPluginSettings,
});

export default defineConfig({
  fmt: formatConfig,
  lint: lintConfig,
  test: {
    // The repository has no test files yet. Remove this when tests are added.
    passWithNoTests: true,
  },
});
