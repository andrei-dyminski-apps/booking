# apps/web — Next.js

## Stack

Next.js 16, App Router, Turbopack, React 19, TypeScript strict, ESM (`"type": "module"`).

## Components

- A **Server Component** by default. Add `"use client"` only when state hooks, effects, browser APIs or event handlers are genuinely needed.
- Put the `"use client"` directive as low in the tree as possible: on the specific interactive component, not on the whole page.
- Components in `packages/ui` that need interactivity mark themselves with `"use client"` (like `src/components/sonner.tsx`) — the page then stays server-rendered. A primitive that only composes a Base UI part (`src/components/button.tsx`) needs no directive: the directive already sits in the Base UI sources.
- Page components are `export default function`. Inner components are arrow functions with an explicit props type (the style of `components/theme-toggle.tsx`).
- Inside the application the imports are the `imports` map of its `package.json`: `#lib/api-client`, `#components/theme-toggle`. A relative path is for a neighbour inside the same route folder.

## Data and API

- **Every call to the API goes through `lib/api-client.ts`.** No `fetch` to the backend from a component or a page: a route is written down there once — method, path and the schema of its answer — so the parse cannot be forgotten and the path cannot drift. A new endpoint means a new method on `bookingsApi` (or a sibling object for a new domain area), not a `fetch` at the call site.
- The client throws two errors and nothing else swallows the rest: `ApiUnreachableError` (the API never answered) and `ApiResponseError` (a non-2xx answer; `issues` carries the per-field validation problems from `apiErrorSchema`). Anything else — a `ZodError` above all — is a drift from the contract and has to propagate.
- Response types and request schemas come from `@repo/contracts`. Do not describe the shape of a response by hand — that is the main source of drift from the backend.
- The error body is part of the contract too (`apiErrorSchema`): do not read `message`/`errors` out of an `unknown` body by hand.
- Parse the API response with a schema (`bookingListSchema.parse(...)`) instead of casting with `as`: a mismatch with the contract has to fail immediately and loudly.
- Validate forms with the same schema that validates the request on the server (`createBookingSchema.safeParse(...)`). Do not write duplicate rules in the component.
- The backend address is `process.env.NEXT_PUBLIC_API_URL` only. Do not hardcode `http://localhost:3001`.
- The variable is inlined at `next build` time and `lib/api-url.ts` is evaluated while Next collects page data, so an unset value fails the build rather than a request: it belongs to the build environment, and changing the address requires a rebuild.
- Server-side fetches carry an explicit `cache`/`next.revalidate`; do not silently rely on the default. The read methods of the client take those options as a required argument, so the decision stays at the call site.

## Styling and components

Tailwind CSS 4 with shadcn/ui on top of Base UI primitives. The components are **generated into `@repo/ui`**, not installed as a dependency — they are ordinary source files of this repository and are edited like any other code.

- The design tokens live in `packages/ui/src/styles/globals.css`; `app/globals.css` is a single `@import "@repo/ui/globals.css"`. Colours, radii and fonts are CSS variables, so write `bg-background` and `text-muted-foreground` rather than `bg-white` or a raw `zinc-800` — otherwise the dark theme breaks.
- The font tokens are the one thing the package does not own: the application loads the faces into `--app-font-sans` / `--app-font-mono` (`next/font` in `app/layout.tsx`) and the token file maps those onto `--font-sans` / `--font-mono`. Never load a face straight into a token name — `--font-sans: var(--font-sans)` is a self-reference that only survives while the `next/font` class outranks the `@layer theme` rule Tailwind emits.
- Tailwind sees only what the `@source` directives of that file name: `packages/ui/src` plus `app/` and `components/` of every application. A new top-level directory with markup needs a line there, or its classes are silently missing from the bundle.
- A new primitive comes from the CLI, run inside the package, and is never written by hand:

```sh
cd packages/ui && pnpm dlx shadcn@latest add dialog
```

The generator formats differently from this repository, so `pnpm lint:fix` from the root belongs in the same step.

- Imports are `@repo/ui/components/<name>`. Inside the package the components reach each other through the `imports` map — `#components/button`, `#lib/utils`.
- Do not edit a generated primitive for the sake of one screen: pass `className`, `cn()` merges it with the base classes. What only one screen needs stays in that route folder (`app/<route>/`); what a second screen needs moves into `@repo/ui`.
- Base UI composes through the `render` prop, not through the `asChild` of Radix: `<PopoverTrigger render={<Button ... />} />`.
- The theme is `next-themes` with the class strategy (`app/providers.tsx`). A component that reads the theme renders on the server too — hence the `mounted` guard in `components/theme-toggle.tsx`.
- No CSS Modules and no other styling libraries. The only hand-written CSS is the token file in the package.

## Checks

```sh
pnpm --filter @repo/web lint          # eslint --max-warnings 0
pnpm --filter @repo/web lint:fix      # eslint --fix, Prettier formatting included
pnpm --filter @repo/web check-types   # next typegen && tsc --noEmit
```

`--max-warnings 0` means a warning equals an error. On top of that the shared config enables `eslint-plugin-only-warn`, which downgrades every error to a warning — so the lint fails on any remark at all. Fix it rather than disabling the rule.

## Port

The port comes from `WEB_PORT` (`next dev --port ${WEB_PORT:-3000}`). Do not write the port into the code and do not change the script.
