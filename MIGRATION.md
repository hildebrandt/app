# Next.js to TanStack Start migration

Date: 2026-11-25

## Scope and target

The repository owner was not available to confirm scope or target. The migration therefore uses the default scope and the documented fallback target:

- Scope: `apps/web` and `apps/docs`.
- Target: TanStack Start with server-side rendering.
- Applications stay separate, with their own route tree, build output, and port.
- `packages/ui` remains a shared workspace package.

TanStack Start preserves the server-rendered HTML and metadata model of the Next.js applications. A client-only TanStack Router application would not preserve the baseline HTML, status codes, or metadata.

The migration ran on Node.js 24.22.3 with pnpm 11.25.0. Installed versions are `@tanstack/react-start` 1.169.7, `@tanstack/react-router` 1.170.46, `srvx` 1.0.8, and `vite` resolved to `@voidzero-dev/vite-plus-core` 8.3.8001 through the workspace catalog.

## Baseline

The baseline was captured from a clean worktree of commit `3f5cb2f` before any migration change. `next build` and `next start` ran for both applications on ports 3000 and 3001. The capture recorded:

- Status, headers, redirect `location` and `refresh` values, redirect body bytes, and body size for `/`, `/_not-found`, `/does-not-exist`, and `/does-not-exist/`.
- Content type, cache headers, and SHA-256 for every file in `public/`.
- Document title, description, language, icon, body text, computed font families and sizes, layout rectangles, links, images, loaded fonts, and screenshots in desktop light, desktop dark, and mobile light.
- The 404 page in desktop light.

The baseline is the parity contract for both applications.

## Inventory

Each application had four `next/*` imports:

- `app/layout.tsx`: `Metadata` from `next` and `localFont` from `next/font/local`.
- `app/page.tsx`: `Image` and `ImageProps` from `next/image`.
- `next.config.js`: a type-only `NextConfig` import.

`packages/ui` had no `next/*` imports. Both applications built the same route table: `/` and `/_not-found`, both statically prerendered. Both type-check scripts ran `next typegen` before `tsc --noEmit`.

## Changes

- Replaced each Next.js application with a TanStack Start application under `apps/*/src`.
- Added `packages/typescript-config/tanstack.json` and extended both application tsconfigs from it.
- Replaced `next build`, `next start`, `next dev`, and `next typegen` with `vp build`, `node start.mjs`, `vp dev`, and `tsc --noEmit`.
- Added `apps/*/vite.config.ts` with the TanStack Start and React plugins.
- Added `apps/*/start.mjs`, which starts `srvx` with the server bundle. Static files are served from `dist/client` by `src/server.ts`, with the baseline cache and content-type headers.
- Moved fonts and the favicon into `public/`, and reproduced the Next.js font faces and fallback metrics in `src/styles/globals.css`.
- Reimplemented the 404 route to match the Next.js status, markup, and cache headers.
- Kept the `/does-not-exist/` to `/does-not-exist` 308 redirect in `src/server.ts`, including the baseline `refresh` header and 15-byte destination body.
- Removed `next`, `next-env.d.ts`, `next.config.js`, the `app/` directories, and the unused `nextjs.json` TypeScript preset.
- Removed the Next.js lint plugin override and the Next.js ignore entries.
- Changed Turborepo build outputs from `.next/**` to `dist/**`.
- Removed the obsolete `"use client"` directive from `packages/ui/src/button.tsx`.

## Parity results

Both applications were built, started on their production ports, and captured with the same script used for the baseline.

| Check                                | web                                    | docs                                   |
| ------------------------------------ | -------------------------------------- | -------------------------------------- |
| `/` status and headers               | match                                  | match                                  |
| `/_not-found` status and headers     | match                                  | match                                  |
| `/does-not-exist` status and headers | match                                  | match                                  |
| `/does-not-exist/` 308 redirect      | match: location, refresh, body         | match: location, refresh, body         |
| `public/` asset bytes and headers    | match                                  | match                                  |
| Title, description, language, icon   | match                                  | match                                  |
| Fonts, computed styles, layout       | match                                  | match                                  |
| 404 screenshot                       | 0 pixels different                     | 0 pixels different                     |
| Home screenshots                     | differ only in the demo edit path text | differ only in the demo edit path text |
| Button alert                         | `Hello from your web app!`             | `Hello from your docs app!`            |

The home page copy was updated from the removed Next.js path to the new TanStack route path. This is the only intentional visual difference. The 404 page does not render a second document title because React hoists it and changes `document.title`; the visible title and metadata match the baseline.

The `/does-not-exist/` response matches the Next.js baseline exactly: status 308, `location: /does-not-exist`, `refresh: 0;url=/does-not-exist`, and the 15-byte body `/does-not-exist` with SHA-256 `b3bd3241f76fec06db8f0d6ba5c273d522dc61dd25d9a02265a23b1e34d67989`. The redirect destination is normalized to one leading slash.

Framework asset URLs and script tags differ because TanStack Start emits its own bundles. The public asset contract, HTML metadata, status codes, redirect headers and body, cache headers, and rendered output are preserved.

## Unpreserved behavior

- Next.js sent `x-nextjs-*`, `x-powered-by`, `vary`, and framework `etag` headers. TanStack Start does not. Status, content type, cache control, and redirect headers match the baseline.
- Next.js statically prerendered `/` and `/_not-found`. TanStack Start renders them per request because this migration uses SSR. The baseline cache control is preserved.
- Next.js bundle URLs, script tags, and generated body classes differ because TanStack Start emits its own client assets.
- The Next.js image optimizer is not used. The page contains static SVG images, which render at the same size and position.

## Revert

Tag `pre-tanstack-migration` points to commit `3f5cb2f`, the last working Next.js version. To restore it:

```sh
git switch -c restore-next pre-tanstack-migration
pnpm install --no-frozen-lockfile
```

Then run `next build` and `next start` in `apps/web` and `apps/docs`. The tag is local to this repository.

## Verification

The migration was verified with:

```sh
pnpm install
pnpm build
pnpm check-types
pnpm lint
```

All four commands must pass on Node.js 24 with pnpm 11.25.0. A fresh clone of the migration head passed all four commands and every parity check, including exact redirect headers and body.
