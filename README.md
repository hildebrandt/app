# app

Turborepo monorepo for the web and documentation applications, managed with pnpm.

## Requirements

- Node.js >= 24
- pnpm 11.25.0, declared by `packageManager`

## Setup

```sh
pnpm install
pnpm dev
```

The web application runs on <http://localhost:3000> and the documentation application runs on <http://localhost:3001>.

## Tasks

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `pnpm dev`         | Start all applications in watch mode |
| `pnpm build`       | Build all applications and packages  |
| `pnpm lint`        | Lint all packages with Oxlint        |
| `pnpm check-types` | Type-check all packages              |
| `pnpm test`        | Run all test suites with Vitest      |
| `pnpm test:coverage` | Run tests and the merged coverage gate |
| `pnpm turbo run e2e` | Run the Playwright suites           |
| `pnpm mutation`    | Run the Stryker mutation gate        |
| `pnpm format`      | Format all files with Oxfmt          |

Lint, formatting, tests, and type checking use Vite+ (`vp lint`, `vp fmt`, `vp test`, `vp check`). Turborepo remains the task runner; `vp run` does not read `turbo.json`.

Per-app `test` tasks are cacheable and write JUnit, JSON, and blob reports under `reports/test/` and `coverage/`. The root `vite.config.ts` defines Vitest Projects for local runs, and `vitest.shared.ts` holds the reporter, output, and per-app coverage settings. `turbo run coverage` merges the app blobs into one report and enforces the root threshold.

Run a task for one package with a filter:

```sh
pnpm turbo build --filter=web
```

## Mutation testing

`pnpm mutation` runs the Stryker gate for every production source file in both `apps/web` and `apps/docs`, including each `start.mjs` launcher. It always runs the full scope with no path filtering, requires a 100% mutation score, and has a 480-second runtime budget. The pre-push hook runs the same command; enable it with `git config core.hooksPath .githooks`. Reports are written to `apps/*/reports/mutation/`; the checked-in baseline, survivor triage, and compatibility notes are in `MUTATION.md`.

## Layout

- `apps/web`: TanStack Start application on port 3000
- `apps/docs`: TanStack Start documentation application on port 3001
- `packages/typescript-config`: shared TypeScript configuration (`@repo/typescript-config`)
- `vite.config.ts`: root Vite+ lint, format, and Vitest Projects/coverage configuration
- `vitest.shared.ts`: shared per-app test reporters, output files, and coverage collection
- `packages/e2e-web`, `packages/e2e-docs`: Playwright suites for the web and docs apps

Both applications render shared UI through `@ui-sdk/react`; the repository has no local UI package.

## Caching

Turborepo stores local task results in `.turbo`. An unchanged second `turbo run test` reports `FULL TURBO` and restores test reports, coverage blobs, and merged coverage. Playwright reports and traces are cached per suite. Remote caching is not configured.
