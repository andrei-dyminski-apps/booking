# Monorepo rules

## Package manager

**pnpm** only. `npm install` / `yarn` break `pnpm-lock.yaml` — do not use them.

Installing a dependency into a specific workspace:

```sh
pnpm add <pkg> --filter @repo/web
pnpm add -D <pkg> --filter @repo/api
pnpm add <pkg> -w              # only for repository-wide tooling
```

Internal packages are wired in as `"@repo/ui": "workspace:*"` — not through a relative path and not through a version from npm.

## Package boundaries

- `apps/*` may depend on `packages/*`. The reverse dependency is forbidden.
- `apps/web` and `apps/api` **never import each other**. They talk over HTTP at the address from `API_ORIGIN`, and the shared contract lives in `packages/contracts`. The browser makes that call through a proxy on the frontend's own origin rather than directly — see "The BFF" in `apps/web/CLAUDE.md`.
- The shape of a request and a response → `packages/contracts` (zod schemas). A contract rule is written there once and works on both sides: request validation in Nest, form validation and response parsing in Next.
- Shared UI and frontend helpers → `packages/ui`. Do not copy components between applications.
- `@repo/ui` is the design system: Tailwind tokens plus shadcn/ui primitives generated into `src/components`. It exports file by file — `"./components/*": "./src/components/*.tsx"`, the same for `./lib/*` and `./hooks/*`, and `./globals.css` for the tokens. The import is `@repo/ui/components/button`, not `@repo/ui`; there is no barrel file and none should be added.
- Inside the package the files reach each other through the `imports` map of its `package.json` (`#components/button`, `#lib/utils`) — that is what the shadcn CLI generates. It is also why `packages/ui/tsconfig.json` declares `rootDir`: without an unambiguous project root TypeScript refuses to resolve an import map pointing at sources.
- How a primitive is added and the conventions around it — in `apps/web/CLAUDE.md`.

## What not to touch

`node_modules`, `.turbo`, `.next`, `dist`, `coverage`, `pnpm-lock.yaml` (changed only through pnpm commands), `.idea`.

Not touching `node_modules` means not editing it — reading it is allowed and expected. When a
question turns on how an installed dependency actually behaves (what a Base UI primitive does
with a disabled item, which props a component forwards), read its sources under
`node_modules/.pnpm/<pkg>@<version>/...` rather than guessing or leaving it unverified. The
installed version is the one that runs, which docs for another version may not describe.
