# @repo/web

The `booking` frontend on Next.js 16 (App Router, Turbopack, React 19), organized by **Feature-Sliced Design**.

Installation, environment variables and the shared commands are described in the [repository README](../../README.md) — everything is run from the root.

```sh
pnpm turbo run dev --filter=@repo/web
pnpm turbo run lint --filter=@repo/web
pnpm turbo run check-types --filter=@repo/web
```

## Structure

`app/` belongs to Next.js and holds routing only — every file there is a one-line re-export. The code lives in `src/`, where the layers Next.js has already named are prefixed (`app` → `_app`, `pages` → `_pages`), as the FSD guide for Next.js prescribes.

```
app/                     # layout.tsx, page.tsx — re-exports; favicon.ico
src/
  _app/                  # the shell in segments: layout, providers, styles, fonts
  _pages/                # one slice per route, with everything that route needs
  features/              # a user action a second page also runs (the listing form)
  entities/              # a domain model a second page also needs (none yet)
  shared/                # no domain knowledge: api transport and routes, config
```

The layer list follows FSD v2.1: code starts in the page that uses it and moves down only
when a second page needs it, `widgets/` is not adopted at all, and CRUD over a resource
(`shared/api/bookings.ts`) counts as infrastructure rather than a domain model.

- A layer imports downwards only (`_app → _pages → features → entities → shared`), and never a sibling slice of its own layer. Steiger checks both halves inside `pnpm lint`, so a violation fails the check.
- A slice is entered through its `index.ts`: the `imports` map of `package.json` maps `#_pages/home` onto `src/_pages/home/index.ts`, so a deep import into another slice cannot even be spelled. Inside a slice the paths are relative.
- Segments describe the nature of the code: `ui/`, `api/`, `model/`, `lib/`, `config/`. They appear when a slice needs them; empty layers and empty segments are not created up front. `_app` and `shared` hold no slices — their direct children are segments, each with its own `index.ts` (`#_app/layout`, `#shared/api`), and the app layer has no `ui` segment.
- `pnpm lint` runs two tools: ESLint with the ordinary rules of the repository (TypeScript, React, Prettier) and [Steiger](https://github.com/feature-sliced/steiger) with all of the FSD ones — boundaries, cross-imports, public-API sidesteps and the shape of the tree. There are no FSD rules in `eslint.config.js`: Steiger resolves an import to a file rather than matching its text, so it catches cases a per-file rule cannot, and one owner means one place to configure. The two rules turned off in `steiger.config.js` carry their reason in a comment.

## Notable points

- Pages are server components by default. `"use client"` goes on the specific interactive component, not on the whole page — `src/_pages/home/ui/theme-toggle.tsx` is the reference. Nothing inside `src/` has a default export; the one a route needs is produced by the re-export in `app/`.
- Every call to the API goes through `src/shared/api`: `http-client.ts` is the transport, `bookings.ts` and `listings.ts` the routes of each resource. The segment exports the resource and the two errors, not `apiRequest`. Types and request schemas come from `@repo/contracts`; the response is parsed with a schema, and a submitted form is validated by the same schema as the request on the backend.
- The browser never calls the API directly. It calls `/api/...` on this origin and `app/api/[...path]/route.ts` forwards the request, which is what makes the session a first-party cookie of whatever hostname the frontend is deployed to; a server render skips the proxy and goes straight to `API_ORIGIN`. The transport aborts a request that has taken more than ten seconds, and answers a 401 in the browser with one refresh and one replay — deduplicated across tabs through `navigator.locks`.
- A form that opens a session submits to a Server Action (`src/_pages/{login,register}/api/*-action.ts`): cookies are written on the server, and the form works before React has hydrated. Closing one is the exception — revoking the refresh family needs the refresh token, which is scoped to `/api/auth` and therefore reaches the browser only, so `logout-button.tsx` calls the API itself and follows it with `router.refresh()`.
- The role of the session decides which screens are offered and which one a visitor is shown, never what is allowed: `requireRole` sends the wrong role to `notFound()`, the header renders the owner's link for owners, and every request behind both is still refused on its own merits by the guards in `apps/api`. The owner's own section is `/dashboard`, with the listings CRUD on it.
- The header renders on the server and sees only the access token, so a visitor whose fifteen minutes lapsed reads as a stranger. `src/_app/layout/session-recovery.tsx` is what spends the week-long refresh token in that case — once per visit, and only when the server reported nobody.
- The interface is built from `@repo/ui`: Tailwind CSS 4 tokens and shadcn/ui primitives on Base UI, generated into the package as source files. That package is the design system — the `shared/ui` of this project — and the import is per file: `import { Button } from "@repo/ui/components/button"`.
- A new primitive is added by the CLI from `packages/ui` (`pnpm dlx shadcn@latest add dialog`), followed by `pnpm lint:fix` from the root. Composition specific to one screen stays in the `ui/` segment of that page's slice.
- Styling is Tailwind utilities over the tokens of `@repo/ui/globals.css`; there are no CSS Modules. The theme is switched by `next-themes` through a class on `<html>`.
- The faces are loaded here (`src/_app/layout/root-layout.tsx`) into `--app-font-sans` / `--app-font-mono`; the tokens of `@repo/ui` map those onto `--font-sans` and `--font-mono`. The names differ on purpose — a token defined as `var(--font-sans)` would reference itself.
- Tests are Vitest, `*.spec.ts` next to the code, run from the root with `pnpm test`. What has one is narrow on purpose: a parser whose input somebody else writes — `shared/lib/next-path.ts` (where a visitor is sent after signing in) and the `Set-Cookie` reader behind `mirrorSessionCookies`. Both are security decisions, and neither is visible in a diff.
- The port comes from `WEB_PORT` (3000 by default), the backend address from `API_ORIGIN`. The latter is read on the server and never inlined into the bundle, so changing the address is a restart rather than a rebuild.
