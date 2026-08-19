# apps/web — Next.js

## Stack

Next.js 16, App Router, Turbopack, React 19, TypeScript strict, ESM (`"type": "module"`).

## Components

- A **Server Component** by default. Add `"use client"` only when state hooks, effects, browser APIs or event handlers are genuinely needed.
- Put the `"use client"` directive as low in the tree as possible: on the specific interactive component, not on the whole page.
- Components in `packages/ui` that need interactivity mark themselves with `"use client"` (like `src/button.tsx`) — the page then stays server-rendered.
- Page components are `export default function`. Inner components are arrow functions with an explicit props type (the style of `app/page.tsx`).

## Data and API

- **Every call to the API goes through `lib/api-client.ts`.** No `fetch` to the backend from a component or a page: a route is written down there once — method, path and the schema of its answer — so the parse cannot be forgotten and the path cannot drift. A new endpoint means a new method on `bookingsApi` (or a sibling object for a new domain area), not a `fetch` at the call site.
- The client throws two errors and nothing else swallows the rest: `ApiUnreachableError` (the API never answered) and `ApiResponseError` (a non-2xx answer; `issues` carries the per-field validation problems from `apiErrorSchema`). Anything else — a `ZodError` above all — is a drift from the contract and has to propagate.
- Response types and request schemas come from `@repo/contracts`. Do not describe the shape of a response by hand — that is the main source of drift from the backend.
- The error body is part of the contract too (`apiErrorSchema`): do not read `message`/`errors` out of an `unknown` body by hand.
- Parse the API response with a schema (`bookingListSchema.parse(...)`) instead of casting with `as`: a mismatch with the contract has to fail immediately and loudly.
- Validate forms with the same schema that validates the request on the server (`createBookingSchema.safeParse(...)`) — see `app/bookings/booking-form.tsx`. Do not write duplicate rules in the component.
- The backend address is `process.env.NEXT_PUBLIC_API_URL` only. Do not hardcode `http://localhost:3001`.
- The variable is inlined at `next build` time and `lib/api-url.ts` is evaluated while Next collects page data, so an unset value fails the build rather than a request: it belongs to the build environment, and changing the address requires a rebuild.
- Server-side fetches carry an explicit `cache`/`next.revalidate`; do not silently rely on the default. The read methods of the client take those options as a required argument, so the decision stays at the call site.

## Styling

CSS Modules (`page.module.css`, `styles.page`). Global styles live in `app/` only. No new styling libraries without being asked.

## Checks

```sh
pnpm --filter @repo/web lint          # eslint --max-warnings 0
pnpm --filter @repo/web lint:fix      # eslint --fix, Prettier formatting included
pnpm --filter @repo/web check-types   # next typegen && tsc --noEmit
```

`--max-warnings 0` means a warning equals an error. On top of that the shared config enables `eslint-plugin-only-warn`, which downgrades every error to a warning — so the lint fails on any remark at all. Fix it rather than disabling the rule.

## Port

The port comes from `WEB_PORT` (`next dev --port ${WEB_PORT:-3000}`). Do not write the port into the code and do not change the script.
