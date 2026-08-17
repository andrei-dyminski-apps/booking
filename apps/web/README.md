# @repo/web

The `booking` frontend on Next.js 16 (App Router, Turbopack, React 19).

Installation, environment variables and the shared commands are described in the [repository README](../../README.md) — everything is run from the root.

```sh
pnpm turbo run dev --filter=@repo/web
pnpm turbo run lint --filter=@repo/web
pnpm turbo run check-types --filter=@repo/web
```

## Notable points

- Pages are server components by default. `"use client"` goes on the specific interactive component, not on the whole page. `app/bookings/` is the reference: the page is server-rendered, only the form is interactive.
- Types and request schemas come from `@repo/contracts`. The API response is parsed with a schema, and the form is validated by the same schema as the request on the backend.
- Shared components come from `@repo/ui` file by file: `import { Button } from "@repo/ui/button"`.
- Styling is CSS Modules (`*.module.css`).
- The port comes from `WEB_PORT` (3000 by default), the backend address from `NEXT_PUBLIC_API_URL`. That variable is inlined into the bundle at `next build`, so changing the address requires a rebuild.
- The interface text is Russian, while validation messages coming from `@repo/contracts` and the API are English — see the language rule in `.claude/rules/workflow.md`.
