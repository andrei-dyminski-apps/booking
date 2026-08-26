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
    login/page.tsx            # one line per route, and nothing else
    register/page.tsx
    profile/page.tsx
    api/[...path]/route.ts    # the BFF: one line, the four methods of the proxy
  proxy.ts                    # what Next.js 16 calls middleware; re-export + the matcher
  src/
    _app/                     # the shell, in segments — the app layer has no `ui`
      layout/root-layout.tsx  # <html>, <body>, metadata, the header
      layout/header.tsx       # the frame: brand, the session links, the theme toggle
      layout/session-recovery.tsx  # the one rotation a server-rendered header cannot run
      layout/theme-toggle.tsx
      layout/index.ts
      providers/providers.tsx # theme + toaster, the only client boundary around the tree
      providers/index.ts
      proxy/proxy.ts          # the cookie gate in front of the protected routes
      proxy/index.ts
      bff/api-proxy.ts        # the browser's only way to the API; re-scopes the session
      bff/index.ts
      styles/globals.css      # a single @import "@repo/ui/globals.css"
      fonts/                  # the faces loaded by next/font
    _pages/                   # one slice per route: everything that route needs
      home/ui/home-page.tsx
      home/index.ts
      login/ui/login-page.tsx
      login/ui/login-form.tsx
      login/api/login-action.ts           # the Server Action the form submits to
      login/model/use-session-resume.ts   # the silent refresh beside the form
      login/index.ts
      register/ui/register-page.tsx
      register/ui/register-form.tsx
      register/api/register-action.ts
      register/index.ts
      profile/ui/profile-page.tsx
      profile/ui/logout-button.tsx        # the browser's call: only it holds a refresh token
      profile/index.ts
    features/                 # a user action a second page also runs (none yet)
    entities/                 # a domain model a second page also needs (none yet)
    shared/                   # no domain knowledge: transport, routes, config
      api/http-client.ts      # apiRequest(), refreshSession(), the two errors
      api/auth.ts             # authApi, currentUser(), requireUser()
      api/session-cookies.ts  # the API's Set-Cookie, re-issued for this origin
      api/bookings.ts         # bookingsApi — the routes of the resource
      api/index.ts
      config/api-url.ts       # apiOrigin() and BFF_BASE_PATH
      config/routes.ts        # ROUTES — every path of this application
      config/index.ts
      lib/form-errors.ts      # zod issues and API errors onto one shape for a form
      lib/next-path.ts        # a `?next=` that cannot leave this site
      lib/index.ts
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
  `src/_app/layout/theme-toggle.tsx`. The `export default` a route needs is
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
- **The segment crosses the client/server boundary, and that is a constraint on how it is
  written.** One `index.ts` serves both sides, and both sides genuinely need it: a Server
  Action reaches `authApi.login`, a client component reaches `refreshSession` and
  `authApi.logout`. So a server-only module in here is not free to say so — a static
  `next/headers`, or an `import "server-only"`, puts the whole barrel in a client module
  graph that refuses to bundle it. **Reach `next/headers` through `await import(...)`**,
  as `http-client.ts` and `session-cookies.ts` do, and keep the reason next to it.

  A build that fails because someone made that import static is the rule working, not a
  bug to route around: what it is saying is that server-only code has been added to a
  module a client component reaches.

  Splitting the segment in two along that line has been considered and rejected. It buys
  little: `bookings.ts` is already tree-shaken out of the browser, the BFF and `apiOrigin()`
  never cross at all, and what does cross — `auth.ts` with the cookie mirroring behind it —
  crosses because a client component imports `authApi`, which a split barrel would not
  change. Measured, it is on the order of a kilobyte, and a lazy import made the bundle
  larger rather than smaller. The cost would be a segment named after where its code runs
  rather than after what it is, which is not how a segment is named here.

- **The base URL depends on which side is asking**, and `baseUrl()` in `http-client.ts` is
  the only place that knows: the browser calls `BFF_BASE_PATH` on this origin, a server
  render calls `apiOrigin()` and reaches Nest directly. Routing a server render through
  this server's own route handler would buy a second hop and nothing else.
- **The session travels differently on each of those two paths, and neither is a concern
  of a call site.** In the browser it is a first-party cookie of this origin, so
  `credentials: "same-origin"` is all it takes. A server render has no cookie jar at all,
  so `http-client.ts` copies the access cookie out of the request Next.js is answering
  (`next/headers`) — in the transport, never at the call site. It does that only for an
  uncached read: the answer to a cached one goes into the Data Cache under its URL and is
  served to whoever asks next, so a personal credential must not reach it. That also keeps
  a read which needs no session out of `cookies()`, and with it out of dynamic rendering.
- **The client address travels with it, and for a reason that is easy to miss.** A Server
  Action and a server render are the one path that does not go through the BFF, so the
  `x-forwarded-for` the proxy forwards is never written for them. Without it the API sees
  every visitor arriving from this server's single address and buckets them together —
  which would turn the limit of 10 a minute on `/auth/login` into a limit for the whole
  site, and the API-wide 120 into a ceiling on page views. `serverHeaders` passes the
  header on rather than inventing it: what the platform in front of this server states is
  the truth, and an absent header means there is nothing in front to state it.
- **A 401 in the browser is worth one refresh and one replay**, and the transport spends
  both without the call site knowing. `retryOnUnauthorized: false` is what switches it off
  for the routes of the session itself — see "The session" below.
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
- Validate a submitted form with the same schema that validates the request in Nest
  (`createBookingSchema.safeParse(...)`), in the Server Action that receives it. Do not
  write duplicate rules in the component.
- The backend address is `process.env.API_ORIGIN` only, read through `apiOrigin()` in
  `shared/config/api-url.ts`. Do not hardcode `http://localhost:3001`.
- The variable is read on the server and on demand. It is not `NEXT_PUBLIC_`, because the
  browser has no use for it any more: nothing reaches the API except through the BFF. So
  it is not inlined at `next build`, it does not belong to the environment of the build,
  and changing the address is a restart rather than a rebuild. There is still no fallback
  — an unset value fails the request with its own name in the message.
- Server-side fetches carry an explicit `cache`/`next.revalidate`; do not silently rely on
  the default. The read methods take those options as a required argument, so the decision
  stays at the call site.

## The BFF

The browser never talks to Nest. It calls `/api/...` on this origin, and
`app/api/[...path]/route.ts` — one line over `src/_app/bff` — forwards the request. A
server render is the exception and goes direct, because it has no cookie to worry about.

The reason is the session. `apps/web` deploys to Vercel and `apps/api` to Railway, which
are different sites however the domains are arranged, and a preview deployment on a
throwaway `*.vercel.app` hostname is a different site again. A cookie that has to cross
that boundary needs `SameSite=None`, which Safari's tracking prevention drops and the
other browsers are following. Behind the proxy the question does not arise.

- **It decides nothing.** Authentication, authorization and validation stay in Nest. What
  the handler does is forward a request and re-scope two cookies; a rule that appears in
  it is a rule in the wrong place.
- **The session is taken over, not passed through** (`shared/api/session-cookies.ts`). The
  API still answers with `Set-Cookie` for its own host; the proxy drops those headers and
  writes the same two tokens again for this origin. `Max-Age` is copied rather than
  re-decided, so `JWT_ACCESS_TTL` and `JWT_REFRESH_TTL` keep one owner.
- **The scopes are the API's, translated**: `access_token` to `/` and `refresh_token` to
  `/api/auth`. So a request for a page carries the access token and a request to
  `/api/bookings` does not carry the credential that mints sessions — the same property
  the API's own scopes buy, on this origin.
- **`SameSite=Lax` is still the CSRF defence** it was before, and it is now the only one:
  the proxy shares an origin with the pages, so nothing else stands between another site
  and a state-changing request. A cross-site POST carries no `lax` cookie, which is what
  closes it.
- **Upstream headers are an allow-list, not a deny-list** (`FORWARDED_HEADERS`). The
  cookie header is rebuilt from the two names of the contract, so the API is handed the
  session and nothing else this origin has collected.
- **`x-forwarded-for` is forwarded on purpose, and forwarded rather than appended to.**
  The API's rate limiter buckets by client address, and without it every visitor would
  arrive from this server's address and share one bucket. What this handler does not do is
  add an entry of its own, so it is not itself a hop `TRUST_PROXY` counts — the entry that
  appears comes from the proxy in front of the API, which sees this server as an ordinary
  client. The API reads the header from the right, so an invented value always sits
  further left than the entries it trusts, and the only way to make it forgeable is to set
  `TRUST_PROXY` higher than the number of proxies that really append.
- Three things follow for free, and each of them removed a deployment concern: there is no
  CORS left to configure, `AUTH_COOKIE_DOMAIN` stops being a problem of the frontend, and
  the address of the API stops being a build-time constant in the bundle.

## The session

Two cookie scopes shape everything below: the access token is scoped to `/` and the
refresh token to `/api/auth`. So a page render sees a visitor's access token and never
their refresh token, and only the browser can turn an expired session into a live one.

- **`proxy.ts` is a gate, not the check.** It answers one question — is there an access
  cookie — and redirects to `/login?next=…` when there is not. It cannot do more: the
  cookie is httpOnly and only the API holds the secret that would verify it. The page
  behind it therefore still reads `/auth/me` and still handles a 401.
- **The matcher is a literal in `proxy.ts`.** Next.js parses it out of that file while
  building, before any import is evaluated: a re-exported `config` is refused outright and
  `ROUTES.profile` would be an unresolved name. The function itself lives in
  `src/_app/proxy` like the rest of the shell. A new protected route is a line there.
- **A page with nothing to show a stranger calls `requireUser(next)`**, not `currentUser`
  followed by a `redirect` of its own. Where to come back to is an argument because a
  server render is not told its own path.
- **An expired access token is not a signed-out user**, and the transport is what knows
  the difference: a 401 in the browser buys one `/auth/refresh` and one replay of the
  request that failed. Only the browser, because it is the only side ever handed a refresh
  token.
- **One refresh at a time, for the whole browser.** Rotation burns the token it is given,
  so several tabs waking up together would queue up spending each other's successors. A
  module-level promise collapses that within a tab and `navigator.locks` — the only mutex
  a browser has that spans its tabs — collapses it across them; a mark in `localStorage`
  lets the tab that waited skip a rotation the winner has just performed. It lives in
  `http-client.ts` rather than with the other session routes because the transport is what
  has to spend it in the middle of somebody else's request.
- **That mark is read before the wait and compared after it**, never trusted on its own.
  It is not evidence that a rotation happened recently — it is evidence that one happened
  _while this call was queued_, and only the second reading survives a logout: cookies are
  thrown away without the mark going with them, so a mark believed on age alone would
  report a session that no longer exists, and the login page would bounce off `/profile`
  and back for as long as the mark looked fresh. For the same reason its value is a token
  rather than a time: it is only ever compared for equality.
- **`retryOnUnauthorized: false` on the routes of the session itself.** A 401 from
  `/auth/login` is a wrong password and from `/auth/refresh` a dead session: refreshing
  and trying again would be nonsense in the first case and endless recursion in the
  second.
- **A rotation runs beside the form, never in place of it**
  (`_pages/login/model/use-session-resume.ts`). That is the case the transport cannot
  cover: a cold arrival has been refused nothing yet, so there is no 401 to react to. It
  needs no guard against StrictMode any more — the single flight above is the guard. What
  it must not do is withhold the form until it answers: that would put the state of a
  client hook in front of the one form on this site that has to work with no JavaScript.
- **The shell runs the same rotation, once per visit**
  (`_app/layout/session-recovery.tsx`). A server-rendered header sees only the access
  token, so a visitor whose fifteen minutes lapsed reads as a stranger while their week-long
  refresh token is still good — and a public page makes no browser request for the transport
  to catch a 401 on. So the shell asks once itself, and only when the server reported
  nobody. The latch that stops it asking twice is module-level on purpose: it has to
  survive the `router.refresh()` it triggers, and it is released again by a render that
  does report somebody.
- **A form submits to a Server Action**, and the two that open a session (`login/api`,
  `register/api`) are the reason: cookies are written on the server, the same contract
  schema refuses an obvious mistake before a request is spent, and the form works before
  React has hydrated. A login is the one form on a site that has to.
- **Closing one is the exception, and the cookie scope is why** (`profile/ui/logout-button.tsx`).
  Revoking a refresh family means handing the API the refresh token, and only the browser
  is ever given one: it is scoped to `/api/auth`, so a Server Action — which posts to the
  URL of the page it sits on — never receives it. An action would clear the cookies of a
  family nobody revoked, and a stolen token would outlive the "Sign out" by a week. So the
  logout is a browser call through the BFF, followed by `router.refresh()`.
- **The inputs of those forms stay controlled** even though the action reads the request
  rather than the state. React resets an uncontrolled form once an action settles, which
  would wipe what the visitor typed at the moment the message explaining it appears.
- **The forms show what comes back under the same field names** —
  `shared/lib/form-errors.ts` maps a zod issue and an `apiErrorSchema` issue onto one
  shape, because they are the same thing on two sides of the wire.
- **A `?next=` is a path of this site or it is nothing** (`shared/lib/next-path.ts`):
  `//evil.com` and `/\evil.com` are absolute URLs to a browser, and following one would
  make the login page an open redirect. The action checks it again after the page has:
  an action is an endpoint of its own, and this one ends in a redirect.

## Mutations and revalidation

Where a mutation goes:

| What it is                                              | Where                         |
| ------------------------------------------------------- | ----------------------------- |
| Opens a session                                         | Server Action                 |
| Changes something the server renders                    | Server Action                 |
| Needs a credential scoped away from the page (a logout) | the client, over `shared/api` |
| Lives in a client screen with optimistic UI or polling  | the client, over `shared/api` |

A Server Action is the default, and it is what the `api/` segment of a page slice holds.
The client path is for what a round trip cannot express — an optimistic update with a
rollback, a poll for a webhook that has not landed yet — and it goes through
`shared/api` like every other call.

How the result is made visible, by what kind of data it is:

| Data                                            | Read                | Invalidated by                |
| ----------------------------------------------- | ------------------- | ----------------------------- |
| Personal (`/auth/me`, a visitor's own bookings) | `cache: "no-store"` | `refresh()` from `next/cache` |
| Public and shared (the catalogue)               | `next: { tags }`    | `revalidateTag(tag, "max")`   |
| A row its author has just edited                | `next: { tags }`    | `updateTag(tag)`              |
| Anything, from a webhook (a Route Handler)      | —                   | `revalidateTag` only          |

- `refresh()` and `updateTag` are Server Actions only; a Route Handler that calls either
  throws, and `revalidateTag` is what it has instead.
- `revalidateTag(tag, "max")` — the single-argument form is deprecated in Next 16.
- `router.refresh()` is the client-side equivalent of the first row and nothing more: it
  re-renders, it does not touch the Data Cache. It is right where the change was made in
  the browser (the session resume) and wrong for anything cached.
- Personal data is never given a tag and never cached. The Data Cache is keyed by URL and
  shared between visitors — a tag would only make it easier to serve one person's
  bookings to the next one.
- A cached read has to name its tags at the call site, in the `ReadOptions` the read
  methods already take. Nothing checks that a tag exists; the linter cannot see it, so it
  is a matter of review.

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
  `src/_app/layout/theme-toggle.tsx`.
- No CSS Modules and no other styling libraries. The only hand-written CSS is the token
  file in the package.

## Checks

```sh
pnpm --filter @repo/web lint          # eslint --max-warnings 0 && steiger ./src
pnpm --filter @repo/web lint:fix      # eslint --fix, Prettier formatting included
pnpm --filter @repo/web check-types   # next typegen && tsc --noEmit
pnpm test                             # vitest, from the root — see below
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

### Tests

**Vitest**, `*.spec.ts` next to the code, `environment: "node"` and no `jsdom`. Run it from
the root (`pnpm test`) — the task declares `dependsOn: ["^build"]`, and a spec that touches
`@repo/contracts` needs its `dist/`.

What has a spec here is narrow on purpose, and the rule is worth stating so the suite does
not drift into testing the framework: **logic a reviewer cannot re-check by reading it once**
— a parser whose input somebody else writes, a security gate, or an invariant that only
breaks under concurrency or a malformed answer. Four kinds, all in `src/shared` or `_app`
because that is where this logic lives, none of them a component:

- A parser of untrusted input — `shared/lib/next-path.ts` (where a visitor is sent after
  signing in) and the `Set-Cookie` reader inside `shared/api/session-cookies.ts` (what
  becomes a cookie of this origin).
- A security gate — `_app/proxy/proxy.ts`, which decides whether a request reaches a page
  or is bounced to `/login?next=…`.
- A concurrency or protocol invariant — the single-flight session refresh and the
  retry-one-401-once rule in `shared/api/http-client.ts`: both have a real way to be wrong
  (a second rotation spent on an already-refreshed session, a retry loop) that only shows up
  under a race or a specific server answer, not by reading the function.
- A mapping with more than one rule to keep straight — `shared/lib/form-errors.ts` (a zod
  issue and an `apiErrorSchema` issue reduced to one shape) and `shared/config/api-url.ts`
  (the trailing slash, the missing-env failure, the module-level cache).

A component is not tested: one that would break is one `check-types` and Steiger already
refuse. Nor is a Server Action's own body once it is only forwarding to `authApi` and
`mirrorSessionCookies` — both are already covered where they live, and re-asserting the
forward would test the mock rather than the code.

**New functionality gets a spec in the same change precisely when it fits one of the four
kinds above** — not by default, and not for a component or a Server Action's plumbing.
Judge it by the question above: would a reviewer actually catch a regression here by
reading the diff, or does it need a runner to provoke a race, a malformed answer, or an
edge of untrusted input? The second is what earns a `*.spec.ts`.

The session-cookies case is reached through `mirrorSessionCookies` rather than by exporting
the parser for the test. What has to hold is not "the header splits into parts" but "the
API's answer becomes these cookies and nothing else does", and the fixtures are therefore
the headers Express actually writes in `apps/api/src/auth/cookies.ts` — `Expires` next to
`Max-Age`, both spellings of forgetting a cookie, the `Domain` that must not be carried
over. The `http-client.ts` case needs no `jsdom` either: `window`, `navigator.locks` and
`localStorage` are stubbed by hand (`vi.stubGlobal`) rather than rendered, because what is
under test is the retry and locking logic, not a browser.

## Port

The port comes from `WEB_PORT` (`next dev --port ${WEB_PORT:-3000}`). Do not write the port
into the code and do not change the script.
