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
| `pnpm mutation`    | Run the Stryker mutation gate        |
| `pnpm format`      | Format all files with Oxfmt          |

Lint, formatting, tests, and type checking use Vite+ (`vp lint`, `vp fmt`, `vp test`, `vp check`). Turborepo remains the task runner; `vp run` does not read `turbo.json`.

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
- `vite.config.ts`: shared Vite+ lint, format, and test configuration

Both applications render shared UI through `@ui-sdk/react`; the repository has no local UI package.

## Caching

Turborepo stores local task results in `.turbo`. An unchanged second build reports `FULL TURBO`. Remote caching is not configured.
