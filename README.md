# app

Turborepo monorepo for the web and backend applications, managed with pnpm.

## Requirements

- Node.js >= 24
- pnpm 11.25.0, declared by `packageManager`

## Setup

```sh
pnpm install
pnpm dev
```

The web application runs on <http://localhost:3000> and the backend runs on <http://127.0.0.1:3001>.

Set `LLM_API_KEY` in the shell that runs `pnpm dev` to enable chat. Turborepo passes it only to the backend dev task.

To use a different backend port, set `BACKEND_PORT` and the matching `CHAT_BACKEND_URL` before running `pnpm dev`.

Run `pnpm --filter backend build` and then `pnpm --filter backend start` to start the backend from its production build.

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

Lint, formatting, and tests use Vite+ (`vp lint`, `vp fmt`, `vp test`). Application type checks use `tsc --noEmit`. Turborepo runs the workspace tasks; `vp run` does not read `turbo.json`.

Per-app `test` tasks are cacheable and write JUnit, JSON, and blob reports under `reports/test/` and `coverage/`. The root `vite.config.ts` defines Vitest Projects for local runs, and `vitest.shared.ts` holds the reporter, output, and per-app coverage settings. `turbo run coverage` merges the app blobs into one report and enforces the root threshold.

Run a task for one package with a filter:

```sh
pnpm turbo build --filter=web
```

## Mutation testing

`pnpm mutation` runs the Stryker gate for both applications, including each `start.mjs`. It runs the full configured scope without path filtering. Reports are written to `apps/*/reports/mutation/`; see `MUTATION.md` for thresholds and toolchain details.

## Layout

- `apps/web`: TanStack Start application on port 3000
- `apps/backend`: Node.js chat API on port 3001
- `packages/typescript-config`: shared TypeScript configuration (`@repo/typescript-config`)
- `vite.config.ts`: root Vite+ lint, format, and Vitest Projects/coverage configuration
- `vitest.shared.ts`: shared per-app test reporters, output files, and coverage collection
- `packages/e2e-web`: Playwright suite for the web application

The web application uses `@ui-sdk/react`; the repository has no local UI package.

## Caching

Turborepo stores local task results in `.turbo`. An unchanged second `turbo run test` restores the per-app test reports and coverage blobs. `pnpm test:coverage` runs the separate merge task. Playwright reports and traces are cached per suite. Remote caching is not configured.
