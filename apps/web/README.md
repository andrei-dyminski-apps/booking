# @repo/web

The `booking` frontend on Next.js 16 (App Router, Turbopack, React 19).

Installation, environment variables and the shared commands are described in the [repository README](../../README.md) — everything is run from the root.

```sh
pnpm turbo run dev --filter=@repo/web
pnpm turbo run lint --filter=@repo/web
pnpm turbo run check-types --filter=@repo/web
```

## Notable points

- Pages are server components by default. `"use client"` goes on the specific interactive component, not on the whole page — `components/theme-toggle.tsx` is the reference.
- Every call to the API goes through `lib/api-client.ts`. Types and request schemas come from `@repo/contracts`; the response is parsed with a schema, and a form is validated by the same schema as the request on the backend.
- The interface is built from `@repo/ui`: Tailwind CSS 4 tokens and shadcn/ui primitives on Base UI, generated into the package as source files. The import is per file: `import { Button } from "@repo/ui/components/button"`.
- A new primitive is added by the CLI from `packages/ui` (`pnpm dlx shadcn@latest add dialog`), followed by `pnpm lint:fix` from the root. Composition specific to one screen stays in `app/<route>/`.
- Styling is Tailwind utilities over the tokens of `@repo/ui/globals.css`; there are no CSS Modules. The theme is switched by `next-themes` through a class on `<html>`.
- The faces are loaded here (`app/layout.tsx`) into `--app-font-sans` / `--app-font-mono`; the tokens of `@repo/ui` map those onto `--font-sans` and `--font-mono`. The names differ on purpose — a token defined as `var(--font-sans)` would reference itself.
- The port comes from `WEB_PORT` (3000 by default), the backend address from `NEXT_PUBLIC_API_URL`. That variable is inlined into the bundle at `next build`, so changing the address requires a rebuild.
