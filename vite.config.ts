import landminesPreset from "@interfere/landmines/configs/all.json" with { type: "json" };
import { defineConfig as defineOxfmtConfig } from "oxfmt";
import { defineConfig as defineOxlintConfig } from "oxlint";
import type { OxlintConfig } from "oxlint";
import ultracite from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import tanstackJsPlugins from "ultracite/oxlint/tanstack/js-plugins";
import vitest from "ultracite/oxlint/vitest";
import { defineConfig } from "vite-plus";

const jsPlugins = selectJsPlugins([
  "github",
  "jsdoc-js",
  "sonarjs",
  "tsdoc",
  "react-doctor",
]);

// SAFETY: JSON imports widen rule severity literals to string; the bundled preset is valid Oxlint config.
const landminesConfig = landminesPreset as OxlintConfig; // oxlint-disable-line typescript/no-unsafe-type-assertion

const configOverrides: OxlintConfig["overrides"] = [
  {
    files: ["**/__root.tsx"],
    rules: { "shadcn/no-inline-styles": "off" },
  },
  {
    files: ["**/start.mjs"],
    rules: { "landmines/no-comments": "off" },
  },
];

const formatConfig = defineOxfmtConfig({
  ...ultracite,
  ignorePatterns: [...ultracite.ignorePatterns, "**/*.md"],
});

const lintConfig = defineOxlintConfig({
  env: core.env,
  extends: [
    core,
    react,
    tanstack,
    vitest,
    jsPlugins,
    tanstackJsPlugins,
    antiSlop,
    shadcn,
    landminesConfig,
  ],
  categories: { correctness: "error" },
  ignorePatterns: core.ignorePatterns,
  jsPlugins: [
    ...jsPlugins.jsPlugins,
    ...antiSlop.jsPlugins,
    ...shadcn.jsPlugins,
    { name: "landmines", specifier: "@interfere/landmines" },
    { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
  ],
  options: { typeAware: true, typeCheck: true },
  overrides: configOverrides,
  rules: {
    "landmines/no-comments": ["error", { allow: ["SAFETY", "WARNING"] }],
    // WARNING: package-scripts resolves allowlist paths from the lint cwd, so one shared config cannot cover root and per-app runs.
    "landmines/package-scripts": "off",
    "shadcn/no-unknown-classes": [
      "error",
      { allow: ["imgDark", "imgLight", "next-error-h1"] },
    ],
    "vite-plus/prefer-vite-plus-imports": "error",
  },
  settings: jsPluginSettings,
});

export default defineConfig({
  fmt: formatConfig,
  lint: lintConfig,
  test: {
    passWithNoTests: false,
  },
});
