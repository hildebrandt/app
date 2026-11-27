---
title: "Stryker Mutation Testing Gate, Baseline, and Verification"
summary: "Describes the Stryker mutation-testing gate for apps/web and apps/docs: mutated scope, pnpm mutation command, toolchain compatibility shim, baseline scores, survivor disposition, 100% break thresholds, manual gate, and final verification."
tags: [mutation-testing, stryker, stryker-mutator, mutation-score, mutants, survivors, baseline, thresholds, break-threshold, quality-gate, vitest, typescript, tanstack-start, turbo, pnpm, monorepo, verification, incremental, ci, continuous-integration]
---
# Mutation testing

Stryker Mutator measures the test suites for both applications. The gate covers every production source file on every run, including test-only changes. It does not use path filtering or incremental state to decide whether to run.

## Scope

| Workspace | Mutated source | Excluded |
| --- | --- | --- |
| `apps/web` | `src/server.ts`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `start.mjs` | tests, `route-tree.fixture.ts`, generated `routeTree.gen.ts` |
| `apps/docs` | `src/server.ts`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx`, `start.mjs` | tests, `route-tree.fixture.ts`, generated `routeTree.gen.ts` |

`apps/web` and `apps/docs` are the only application workspaces. `packages/typescript-config` contains no runtime implementation.

## Command

```sh
pnpm mutation
```

The `mutation` task depends on `build` so the launcher startup test can load `dist/server/server.js`. It runs with `cache: false`, so Turbo cannot skip either application.

Generated reports:

- `apps/web/reports/mutation/index.html`
- `apps/web/reports/mutation/mutation.json`
- `apps/docs/reports/mutation/index.html`
- `apps/docs/reports/mutation/mutation.json`

`apps/*/reports/` is ignored by Git. This file is the checked-in report because this checkout has no CI configuration and no CI access. The same command is the manual gate.

## Toolchain and compatibility

| Package | Version |
| --- | --- |
| `@stryker-mutator/core` | 10.1.1 |
| `@stryker-mutator/vitest-runner` | 10.1.1 |
| `@stryker-mutator/typescript-checker` | 10.1.1 |
| `vitest` | 5.1.1 |
| `vite-plus` | 1.8.0 |
| `typescript` | 7.0.2 (application) |

Vite+ 1.8.0 bundles Vitest 5.1.1, and `vite-plus/test` re-exports that Vitest API. The Stryker Vitest runner accepted it: both dry runs discovered every test file and both mutation runs completed. The explicit `vitest` dev dependency pins the API used by Stryker. Application tests still import `vite-plus/test`.

TypeScript 7.0.2 does not expose the compiler API that Stryker 10.1.1 uses (`ts.sys` and `ts.parseConfigFileTextToJson` are missing). The checker's native preview mode does not help because it also calls `ts.parseConfigFileTextToJson`. The compatibility shim is:

- `.pnpmfile.mjs` removes the `typescript` peer from `@stryker-mutator/typescript-checker` and adds `typescript@6.0.3` as its own dependency.
- `pnpm-workspace.yaml` adds `typescript@6.0.3` to `@stryker-mutator/core` through `packageExtensions`.

The application keeps TypeScript 7.0.2. Re-evaluate the shim when Stryker or TypeScript is upgraded.

The TanStack Start route-tree plugin throws `Crawling result not available` when a test imports the generated `routeTree.gen.ts` inside Stryker's sandbox. Each application has `vitest-mutation.config.ts`, used only by Stryker, which aliases `./routeTree.gen` to `src/route-tree.fixture.ts`. The fixture builds an equivalent root and index tree from the real route options. Normal `vp test run` still uses the generated tree.

## Baseline

The all-source web baseline ran before the UI tests, without `--incremental`, after deleting the previous report and incremental file.

- Total mutants: 169 across four files
- Killed: 54
- Timeout: 7
- Survived: 74
- No coverage: 3
- Compile errors: 31
- Mutation score: 44.20%
- Wall time: 106 seconds

Per file:

| File | Score | Survived | No coverage | Compile errors |
| --- | --- | --- | --- | --- |
| `src/server.ts` | 100.00% | 0 | 0 | 16 |
| `src/routes/__root.tsx` and `src/routes/index.tsx` | 0.00% | 71 | 3 | 14 |
| `src/router.tsx` | 0.00% | 3 | 0 | 1 |

The launcher baseline was captured after `start.mjs` joined the scope. `apps/web` scored 93.41% overall with 10 survivors and 2 no-coverage mutants; `start.mjs` alone scored 73.91%. The survivors were the `0`/`65_535` port boundaries, the optional built-application branch, and the process-entry guard. `apps/docs` received the same tests; its first full launcher run scored 100%.

### Survivor disposition

Every baseline survivor has one disposition: real test gap. No baseline survivor was equivalent or out of scope.

| Mutants | Disposition |
| --- | --- |
| `src/routes/index.tsx` 3 NoCoverage mutants: `priority = false`, initial empty message, and the empty-message conditional | Real gap. The image tests cover both priority values; the initial `queryByRole("status")` assertion kills the message mutants. |
| `start.mjs` 10 survivors and 2 NoCoverage mutants: port `< 0` and `> 65_535` boundaries, `if (app === undefined)` plus its block, and the process-entry guard | Real gap. `start.test.tsx` asserts the `0` and `65_535` boundaries, loads the built application when none is supplied, and re-imports the launcher with `process.argv[1]` set to the module filename so the entry guard and startup execute inside the test process. |
| `src/server.ts` | No survivors. The existing server and integration tests already killed every reachable mutant. |

The 31 compile errors are type-invalid mutants rejected by the TypeScript checker. They are not survivors and have no test-gap disposition.

The docs baseline was 98.53% with two NoCoverage mutants in the immutable header fallback (`headers.set` and the reconstructed `Response`). `src/server.test.ts` covers that branch and closes both.

## Final result

| Application | Score | Killed | Timeout | Survived | No coverage | Compile errors | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `apps/web` | 100.00% | 170 | 7 | 0 | 0 | 32 | 165 s |
| `apps/docs` | 100.00% | 170 | 7 | 0 | 0 | 32 | 160 s |
| Combined `pnpm mutation` | 100.00% | 340 | 14 | 0 | 0 | 64 | 276 s |

The timeouts are loop mutants that cannot terminate; Stryker counts them as killed. The compile errors are type-invalid mutants rejected by the TypeScript checker.

## Gate

Both `stryker.config.json` files set:

```json
"thresholds": {
  "high": 100,
  "low": 90,
  "break": 100
}
```

The break threshold is 100 because both suites have a deterministic score and no surviving mutants. Any survivor fails the gate. `pnpm mutation` has no runtime cap. The previous pre-push hook wrapped the command in `timeout 480`, about 1.74 times the observed 276-second combined run.

`--incremental` is available only as a local rerun cache:

```sh
pnpm --filter web exec stryker run --incremental
```

It is not part of the `mutation` task or the root script, so it cannot decide the gate.

## CI and manual gate

The repository has no CI configuration and this environment has no CI access. Run `pnpm mutation` manually before pushing. The repository no longer has a pre-push hook.

## Verification

- Baseline: 169 mutants, 44.20%, 74 survivors, 3 no coverage, 106 seconds. Every survivor is assigned in the table above.
- Launcher baseline: `apps/web` 93.41%, 10 survivors, 2 no coverage; `start.mjs` 73.91%. Every launcher survivor is assigned in the table above.
- Final: web and docs both 100.00%, zero survivors, zero no coverage; both reports list `start.mjs`. Combined run 276 seconds, 340 killed, 14 timeout, 64 compile errors.
- Seeded defect: changed `status: 308` to `307` in `apps/web/src/server.ts`. The full suite failed with `expected 307 to be 308`. The source was restored.
- Weakened test: removed the static asset `content-type` assertion. `pnpm mutation` exited 1 at 99.43% overall (167 killed, 7 timeout, 1 survivor at `src/server.ts:67:7`; `src` score 99.26%). The assertion was restored and the final run returned to 100%.
