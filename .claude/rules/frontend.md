# apps/web — Next.js

## Stack

Next.js 16, App Router, Turbopack, React 19, TypeScript strict, ESM (`"type": "module"`).
The code is organized by **Feature-Sliced Design**.

## Architecture — Feature-Sliced Design

Routing belongs to Next.js, everything else to FSD. The `app/` folder at the root of the
application holds only what the framework demands — `layout.tsx`, `page.tsx`, later
`route.ts` and `middleware.ts` — and each of those files is a one-line re-export. All the
code lives in `src/`, and the two layers whose names Next.js has already taken are
prefixed, exactly as the FSD guide for Next.js prescribes: `app` → `_app`,
`pages` → `_pages`.

```
apps/web/
  app/                        # Next.js routing only: thin re-exports, favicon.ico
    layout.tsx                # export { RootLayout as default, metadata } from "#_app/layout"
    page.tsx                  # export { HomePage as default } from "#_pages/home"
  src/
    _app/                     # the shell, in segments — the app layer has no `ui`
      layout/root-layout.tsx  # <html>, <body>, metadata
      layout/index.ts
      providers/providers.tsx # theme + toaster, the only client boundary around the tree
      providers/index.ts
      styles/globals.css      # a single @import "@repo/ui/globals.css"
      fonts/                  # the faces loaded by next/font
    _pages/                   # one slice per route: everything that route needs
      home/ui/home-page.tsx
      home/ui/theme-toggle.tsx
      home/index.ts
    features/                 # a user action a second page also runs (none yet)
    entities/                 # a domain model a second page also needs (none yet)
    shared/                   # no domain knowledge: transport, routes, config
      api/http-client.ts      # apiRequest(), ApiUnreachableError, ApiResponseError
      api/bookings.ts         # bookingsApi — the routes of the resource
      api/index.ts
      config/api-url.ts       # NEXT_PUBLIC_API_URL, validated once
      config/index.ts
```

The rules of the methodology, as they apply here:

- **A layer imports downwards only**: `_app → _pages → features → entities → shared`.
  A slice never imports a sibling slice of its own layer either — two features that need
  the same thing push it down into `entities` or `shared`. Both halves are checked by
  Steiger, which runs inside `pnpm lint`, so a violation fails the check rather than
  review.
- **A slice is reached through its public API** — the `index.ts` at its root. The `imports`
  map of `package.json` resolves `#_pages/home` straight to `./src/_pages/home/index.ts`,
  which makes a deep import into another slice impossible to spell rather than merely
  discouraged.
- **Pages first.** New code goes into the slice of the page that uses it and moves down a
  layer only once a second page actually uses it — not because it looks reusable. Steiger
  enforces the same rule from the other side: a feature or an entity with a single consumer
  is reported as an `insignificant-slice`.
- **Inside a slice the paths are relative** (`./ui/home-page`, `../styles/globals.css`).
  That includes `shared`, where the segments reach each other as `../config` — the alias
  is for crossing a layer, not for walking around inside one.
- **Segments name the nature of the code, not its type**: `ui/` markup, `api/` requests to
  the backend, `model/` state and pure logic, `lib/` helpers of the slice, `config/`
  constants. A slice grows a segment when it needs one; empty folders are not created up
  front, and neither are empty layers — `features/` and `entities/` appear with their first
  slice.
- **`_app` and `shared` are sliceless**: their direct children are segments, not slices,
  and each segment carries the `index.ts` (`#_app/layout`, `#shared/api`). The app layer
  has no `ui` segment — markup belongs to a page, and what the shell itself renders is the
  `layout` segment.
- **A new layer is added to the `imports` map** of `apps/web/package.json` in the change
  that creates it, or nothing can import it. Steiger needs no such registration: it knows
  the canonical layer names and guards a new one from its first file.

Where a new piece of code goes:

| What it is                                                      | Where            |
| --------------------------------------------------------------- | ---------------- |
| Used by one page: a block, a form, a fetch, a piece of state    | `_pages/<route>` |
| The same user action, now run by a second page                  | `features/`      |
| The same domain model, now needed by a second page or feature   | `entities/`      |
| CRUD over a resource, the transport, config, a domain-free tool | `shared/`        |
| The frame around every page: providers, layout, fonts, tokens   | `_app/`          |

CRUD is infrastructure rather than a domain model, so `bookingsApi` sits in `shared/api`
next to the transport it uses. An entity slice is for a model with rules of its own, and
only once a second consumer needs it.

### The methodology itself

The rules above are this repository's reading of FSD; the methodology in full is not
copied into them. Two sources carry it, and both are meant to be reached for rather than
remembered:

- `.claude/skills/feature-sliced-design/` — the official FSD skill (v2.1), vendored from
  [feature-sliced/skills](https://github.com/feature-sliced/skills). `SKILL.md` is the
  decision framework; `references/` is loaded on demand — `layer-structure.md`,
  `cross-import-patterns.md`, `excessive-entities.md`, `asset-handling.md`,
  `migration-guide.md`, `framework-integration.md`, `practical-examples.md`.
- The documentation as one plain-text file, for a question the skill does not answer:
  <https://feature-sliced.design/llms-small.txt> (abridged) and
  <https://feature-sliced.design/llms-full.txt> (complete); the index of both is
  <https://feature-sliced.design/llms.txt>. Fetch it, do not vendor it — it is ~300 KB and
  goes stale the moment it is committed.

Where the two disagree, **this file wins** — it describes decisions already taken here,
with the linter configured to match. The three that come up:

- **`widgets/`.** v2.1 discourages adopting the layer, and this repository does not: the
  name appears nowhere — not in the `imports` map, not in the tree. A composition specific
  to one screen stays in its page; the frame around every screen is `_app`.
- **Extraction.** "Start simple, extract when needed" holds literally — `features/` and
  `entities/` are empty, `fsd/insignificant-slice` is on, and a slice appears the day a
  second consumer does.
- **Aliases.** The skill writes `@/features/auth`; here it is `#features/auth`, the
  `imports` map of `package.json`. The mechanism differs, the rule it enforces does not.

## Components

- A **Server Component** by default. Add `"use client"` only when state hooks, effects,
  browser APIs or event handlers are genuinely needed.
- Put the `"use client"` directive as low in the tree as possible: on the specific
  interactive component, not on the page that composes it.
- Components in `packages/ui` that need interactivity mark themselves with `"use client"`
  (like `src/components/sonner.tsx`) — the page then stays server-rendered. A primitive
  that only composes a Base UI part (`src/components/button.tsx`) needs no directive: the
  directive already sits in the Base UI sources.
- Components are arrow functions with an explicit props type — the style of
  `src/_pages/home/ui/theme-toggle.tsx`. The `export default` a route needs is
  produced by the re-export in `app/`, so nothing inside `src/` has a default export.
- A file of the `ui/` segment is named after what it renders (`home-page.tsx`,
  `theme-toggle.tsx`), and the component inside it carries the same name.

## Data and API

- **Every call to the API goes through `src/shared/api`.** No `fetch` to the backend from a
  component or a page: the transport — the base URL, the two errors, the parse of the
  answer — is written down once in `http-client.ts`.
- **The routes live next to it, one file per resource**: `shared/api/bookings.ts` writes
  down method, path and the schema of the answer for each of them. A new endpoint means a
  new method there, a new resource means a sibling file — never a `fetch` at the call site.
- **The public API of the segment is the resource, not the transport**: `shared/api`
  exports `bookingsApi` and the two errors, while `apiRequest` stays inside it. A call
  site that cannot reach the transport cannot spell a path of its own.
- **Every request carries `credentials: "include"`.** The session is an httpOnly cookie
  issued by another origin — the API is a separate host in every environment — and a
  cross-origin `fetch` leaves it behind unless it is asked for; without it a guarded route
  answers 401. A server-side call has no browser cookie jar at all, so forwarding the
  session from `next/headers` belongs in `http-client.ts` the day the first RSC read of a
  guarded route appears — not at the call site.
- **The transport gives up after ten seconds** (`AbortSignal.timeout`) instead of holding
  a render open for the five minutes undici allows; the abort arrives as
  `ApiUnreachableError`. The signal costs Next's per-render memoization — the Data Cache,
  which `read` decides, is untouched.
- The client throws two errors and nothing else swallows the rest: `ApiUnreachableError`
  (the API never answered) and `ApiResponseError` (a non-2xx answer; `issues` carries the
  per-field validation problems from `apiErrorSchema`). Anything else — a `ZodError` above
  all — is a drift from the contract and has to propagate.
- Response types and request schemas come from `@repo/contracts`. Do not describe the shape
  of a response by hand — that is the main source of drift from the backend.
- The error body is part of the contract too (`apiErrorSchema`): do not read
  `message`/`errors` out of an `unknown` body by hand.
- Parse the API response with a schema (`bookingListSchema.parse(...)`) instead of casting
  with `as`: a mismatch with the contract has to fail immediately and loudly.
- Validate forms with the same schema that validates the request on the server
  (`createBookingSchema.safeParse(...)`). Do not write duplicate rules in the component.
- The backend address is `process.env.NEXT_PUBLIC_API_URL` only, read in
  `shared/config/api-url.ts`. Do not hardcode `http://localhost:3001`.
- The variable is inlined at `next build` time and `shared/config/api-url.ts` is evaluated
  while Next collects page data, so an unset value fails the build rather than a request:
  it belongs to the build environment, and changing the address requires a rebuild.
- Server-side fetches carry an explicit `cache`/`next.revalidate`; do not silently rely on
  the default. The read methods take those options as a required argument, so the decision
  stays at the call site.

## Styling and components

Tailwind CSS 4 with shadcn/ui on top of Base UI primitives. The components are **generated
into `@repo/ui`**, not installed as a dependency — they are ordinary source files of this
repository and are edited like any other code. `@repo/ui` is the design system; it plays
the part `shared/ui` plays in a single-package FSD project, and a primitive belongs there
rather than in `src/shared`.

- The design tokens live in `packages/ui/src/styles/globals.css`;
  `src/_app/styles/globals.css` is a single `@import "@repo/ui/globals.css"`. Colours,
  radii and fonts are CSS variables, so write `bg-background` and `text-muted-foreground`
  rather than `bg-white` or a raw `zinc-800` — otherwise the dark theme breaks.
- The font tokens are the one thing the package does not own: the application loads the
  faces into `--app-font-sans` / `--app-font-mono` (`next/font` in
  `src/_app/layout/root-layout.tsx`) and the token file maps those onto `--font-sans` /
  `--font-mono`. Never load a face straight into a token name — `--font-sans:
var(--font-sans)` is a self-reference that only survives while the `next/font` class
  outranks the `@layer theme` rule Tailwind emits.
- Tailwind sees only what the `@source` directives of that file name: `packages/ui/src`
  plus `app/` and `src/` of `apps/web`. The frontend is named rather than globbed as
  `apps/*` — that pattern also matches `apps/api/src`, and a class-looking string in a
  Nest service would emit CSS nobody asked for. A new top-level directory with markup, or
  a second frontend, needs a line there, or its classes are silently missing from the
  bundle.
- A new primitive comes from the CLI, run inside the package, and is never written by hand:

```sh
cd packages/ui && pnpm dlx shadcn@latest add dialog
```

The generator formats differently from this repository, so `pnpm lint:fix` from the root
belongs in the same step.

- Imports are `@repo/ui/components/<name>`. Inside the package the components reach each
  other through the `imports` map — `#components/button`, `#lib/utils`.
- Do not edit a generated primitive for the sake of one screen: pass `className`, `cn()`
  merges it with the base classes. What only one screen needs stays in the `ui/` segment of
  that page's slice; what a second screen needs moves down a layer, and what has no domain
  knowledge at all moves into `@repo/ui`.
- Base UI composes through the `render` prop, not through the `asChild` of Radix:
  `<PopoverTrigger render={<Button ... />} />`.
- The theme is `next-themes` with the class strategy (`src/_app/providers/providers.tsx`). A
  component that reads the theme renders on the server too — hence the `mounted` guard in
  `src/_pages/home/ui/theme-toggle.tsx`.
- No CSS Modules and no other styling libraries. The only hand-written CSS is the token
  file in the package.

## Checks

```sh
pnpm --filter @repo/web lint          # eslint --max-warnings 0 && steiger ./src
pnpm --filter @repo/web lint:fix      # eslint --fix, Prettier formatting included
pnpm --filter @repo/web check-types   # next typegen && tsc --noEmit
```

The lint is two tools in one script, and both have to pass:

- **ESLint** carries the ordinary rules of the repository — TypeScript, React hooks, the
  Next.js plugin, Prettier. It holds **no** FSD rules.
- **Steiger** (`steiger.config.js`) owns the architecture entirely: the layer boundaries
  above, cross-imports between sibling slices, sidesteps of a public API, and the shape of
  the tree that no per-file linter can see (a slice without a public API, a segment in the
  wrong place, a slice with a single consumer).

The split is deliberate. A per-file rule can only match the text of an import, and that
text does not always name a layer — `../../home/ui/home-page` walks into a sibling slice
without spelling one. Steiger resolves the import to a file, so it catches that case and
names it correctly ("sidestep of public API") instead of reporting a generic restricted
path. Keeping half of the same rules in `eslint.config.js` bought only a second place for
them to drift, so they are not there. The trade is that an architectural mistake shows up
when the lint runs rather than while typing; `steiger ./src --watch` closes that gap
during work on the structure.

Two rules are switched off there, each with the reason next to it: `typo-in-layer-name`
for `_app` and `_pages` (Steiger has no setting for the renaming the Next.js guide
prescribes, and reads the prefix as a misspelling), and `no-segmentless-slices` inside
`_app` (it reads that prefixed layer as a sliced one and asks each segment to be divided
again). Everything else is on, `insignificant-slice` included — that one is what keeps
"pages first" honest. Do not silence anything else without writing down why.

`--max-warnings 0` means a warning equals an error. On top of that the shared config
enables `eslint-plugin-only-warn`, which downgrades every error to a warning — so the lint
fails on any remark at all. Fix it rather than disabling the rule. The same holds for
Steiger: an import it refuses is a sign the code sits on the wrong layer, not a reason to
silence the rule.

## Port

The port comes from `WEB_PORT` (`next dev --port ${WEB_PORT:-3000}`). Do not write the port
into the code and do not change the script.
