# apps/web — Next.js

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
    listings/page.tsx
    listings/loading.tsx      # the skeleton of the screen behind it, one line as well
    listings/[id]/page.tsx
    listings/[id]/loading.tsx
    bookings/page.tsx
    bookings/loading.tsx
    messages/page.tsx         # the caller's threads; a guest's and a host's, never an admin's
    messages/loading.tsx
    messages/[id]/page.tsx    # one thread and the reply box
    messages/[id]/loading.tsx
    dashboard/page.tsx
    dashboard/loading.tsx
    dashboard/listings/new/page.tsx
    dashboard/listings/[id]/page.tsx
    admin/page.tsx            # every listing on offer, editable — the admin's section
    admin/loading.tsx
    admin/listings/[id]/page.tsx
    admin/listings/[id]/loading.tsx
    admin/users/page.tsx      # the accounts, each leading to its own page
    admin/users/loading.tsx
    admin/users/[id]/page.tsx # one account: its role, its block, its stays and listings
    admin/users/[id]/loading.tsx
    guests/[id]/reviews/page.tsx  # what hosts said about a guest; the API decides who may look
    guests/[id]/reviews/loading.tsx
    notifications/page.tsx    # the account's whole feed; the bell shows its top
    notifications/loading.tsx
    not-found.tsx             # what notFound() renders — an id, a role, a retired row
    error.tsx                 # the boundary under the shell; "use client" + re-export
    global-error.tsx          # the boundary above it, for a shell that cannot render
    api/[...path]/route.ts    # the BFF: one line, the four methods of the proxy
  proxy.ts                    # what Next.js 16 calls middleware; re-export + the matcher
  src/
    _app/                     # the shell, in segments — the app layer has no `ui`
      layout/root-layout.tsx  # <html>, <body>, metadata, the fonts
      layout/app-shell.tsx    # the sidebar, the header and the one read of the session
      layout/sidebar.tsx      # the navigation as a column, from `lg` up
      layout/mobile-nav.tsx   # the same list in a sheet, below it
      layout/nav-links.tsx    # the links, and the only thing here that needs a pathname
      layout/navigation.ts    # what the shell offers this role, written down once
      layout/account-panel.tsx  # who is signed in, and the way out
      layout/header.tsx       # the bar: the menu button, the theme, the two CTAs
      layout/site-footer.tsx  # the quiet end, and the third thing given the session
      layout/session-recovery.tsx  # the one rotation a server-rendered header cannot run
      layout/theme-toggle.tsx
      layout/notification-bell.tsx  # the unread count off the event stream, the latest in a popup
      layout/unread-conversations-badge.tsx  # the unread threads beside Messages, and the dot on the menu button
      layout/global-error.tsx # the document a failed shell render is replaced with
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
      profile/api/read-review-summary-of.ts # what hosts said, in sum — the figure, the link, or none
      profile/index.ts
      catalogue/ui/catalogue-page.tsx     # the filtered, cursor-paged list of listings
      catalogue/ui/catalogue-toolbar.tsx  # one row: the filters, the ordering, the chips
      catalogue/ui/catalogue-filters-dialog.tsx  # every filter, in a modal
      catalogue/ui/catalogue-card.tsx
      catalogue/ui/catalogue-skeleton.tsx
      catalogue/api/read-catalogue-page.ts  # the cached read, and the cursor it refuses
      catalogue/lib/catalogue-search.ts   # searchParams onto the contract's query
      catalogue/lib/catalogue-search.spec.ts
      catalogue/index.ts
      listing/ui/listing-page.tsx         # one listing: the calendar and the form
      listing/ui/availability-calendar.tsx  # the nights already taken, drawn
      listing/ui/booking-form.tsx         # the only thing here that creates a booking
      listing/ui/listing-reviews.tsx      # the guests' reviews: the summary and the newest page
      listing/ui/listing-skeleton.tsx
      listing/ui/ask-host.tsx             # a guest's question, or the way back to their thread; streamed, degrades
      listing/ui/ask-host-form.tsx
      listing/api/create-booking-action.ts
      listing/api/read-listing-reviews.ts # the cached page, or null — the screen draws without it
      listing/api/start-conversation-action.ts  # opens the thread, redirects into it
      listing/lib/months.ts               # the booked ranges laid out as month grids
      listing/lib/months.spec.ts
      listing/index.ts
      bookings/ui/bookings-page.tsx       # one page, three scopes — the role picks one
      bookings/ui/bookings-toolbar.tsx    # one row: the filters, the ordering, the chips
      bookings/ui/bookings-filters-dialog.tsx  # every filter, in a modal
      bookings/ui/booking-card.tsx
      bookings/ui/booking-status-badge.tsx
      bookings/ui/cancel-booking-button.tsx
      bookings/ui/review-booking-button.tsx  # one half of a finished stay, in a dialog
      bookings/ui/rating-field.tsx        # …its rating, picked as stars: a radio per star
      bookings/ui/bookings-skeleton.tsx
      bookings/api/read-bookings-page.ts  # the personal read, and the cursor it refuses
      bookings/api/cancel-booking-action.ts
      bookings/api/review-booking-action.ts
      bookings/lib/bookings-search.ts     # searchParams onto the contract's query
      bookings/lib/bookings-search.spec.ts
      bookings/index.ts
      messages/ui/messages-page.tsx       # the threads the account is a side of, either role
      messages/ui/conversation-card.tsx
      messages/ui/messages-skeleton.tsx
      messages/index.ts
      conversation/ui/conversation-page.tsx  # a thread read from its end, `?cursor=` for earlier
      conversation/ui/send-message-form.tsx  # empties itself on a send that landed, and on nothing else
      conversation/ui/live-thread.tsx     # a re-render on a message of this thread not drawn yet
      conversation/ui/mark-read.tsx       # the browser's POST /read, up to the newest message drawn, once it is scrolled to, while the tab is visible
      conversation/ui/conversation-skeleton.tsx
      conversation/api/send-message-action.ts
      conversation/index.ts
      dashboard/ui/dashboard-page.tsx     # the owner's listings, read by the session
      dashboard/ui/listing-card.tsx
      dashboard/ui/dashboard-skeleton.tsx
      dashboard/index.ts
      not-found/ui/not-found-page.tsx     # the screen behind every notFound()
      not-found/index.ts
      error/ui/error-page.tsx             # the screen both error boundaries render
      error/index.ts
      listing-new/ui/new-listing-page.tsx
      listing-new/index.ts
      listing-edit/ui/edit-listing-page.tsx
      listing-edit/api/own-listing.ts     # the row of this screen, or a 404
      listing-edit/index.ts
      admin-listings/ui/admin-listings-page.tsx  # every offered listing, filtered in the URL
      admin-listings/ui/admin-listings-toolbar.tsx
      admin-listings/ui/admin-listings-filters-dialog.tsx
      admin-listings/ui/admin-listing-card.tsx
      admin-listings/ui/admin-listings-skeleton.tsx
      admin-listings/api/read-listings-page.ts   # the catalogue's read, `no-store`
      admin-listings/lib/admin-listings-search.ts  # the catalogue's filters plus `ownerId`
      admin-listings/lib/admin-listings-search.spec.ts
      admin-listings/index.ts
      admin-listing-edit/ui/admin-edit-listing-page.tsx
      admin-listing-edit/ui/admin-edit-listing-skeleton.tsx
      admin-listing-edit/api/any-listing.ts      # the row, whoever owns it
      admin-listing-edit/index.ts
      admin-users/ui/users-page.tsx       # the accounts, filtered in the URL
      admin-users/ui/users-toolbar.tsx
      admin-users/ui/users-filters-dialog.tsx
      admin-users/ui/user-card.tsx        # an account, and the link to its page
      admin-users/ui/users-skeleton.tsx
      admin-users/api/read-users-page.ts
      admin-users/lib/users-search.ts     # searchParams onto the contract's query
      admin-users/lib/users-search.spec.ts
      admin-users/index.ts
      admin-user/ui/user-page.tsx         # one account: access, and links to its activity
      admin-user/ui/role-form.tsx         # a box and a button, no confirmation
      admin-user/ui/block-button.tsx      # asks before blocking, not before reopening
      admin-user/ui/user-skeleton.tsx
      admin-user/api/update-user-actions.ts
      admin-user/index.ts
      guest-reviews/ui/guest-reviews-page.tsx  # the hosts' half, paged; reached from a stay or the profile
      guest-reviews/ui/guest-reviews-skeleton.tsx
      guest-reviews/api/read-guest-reviews.ts  # `no-store`, a 404 outside the API's scope
      guest-reviews/index.ts
      notifications/ui/notifications-page.tsx  # the feed, paged; "Mark all as read"
      notifications/ui/mark-all-read-button.tsx
      notifications/ui/notifications-skeleton.tsx
      notifications/api/read-notifications.ts  # `no-store`, a stale cursor onto null
      notifications/api/mark-all-read-action.ts
      notifications/index.ts
    features/                 # a user action a second page also runs
      save-listing/ui/listing-form.tsx    # the one form the new and the edit screen run
      save-listing/ui/pricing-fields.tsx  # …its weekday and date prices, saved with the row
      save-listing/lib/to-number.ts       # a number box's text onto the contract's number
      save-listing/api/save-listing-action.ts
      save-listing/index.ts
      delete-listing/ui/delete-listing-button.tsx  # the owner's edit screen and the admin's
      delete-listing/api/delete-listing-action.ts
      delete-listing/index.ts
      delete-review/ui/delete-review-button.tsx  # the admin's, on a listing's reviews and a guest's
      delete-review/api/delete-review-action.ts
      delete-review/index.ts
      logout/ui/logout-button.tsx         # the browser's call: only it holds a refresh token
      logout/index.ts
      listing-search/model/listing-filters.ts  # the catalogue query's chips, orderings, labels
      listing-search/ui/listing-filter-fields.tsx  # …and its boxes: both listings dialogs
      listing-search/index.ts
    entities/                 # a domain model a second page also needs
      user/model/roles.ts     # the roles named for a person: both admin screens read them
      user/api/any-user.ts    # the account with its counts, or a 404: its page and `?ownerId=`
      user/index.ts
      review/ui/review-card.tsx  # one review, with a slot for what the screen may do to it
      review/ui/rating-stars.tsx
      review/ui/review-summary.tsx  # the mean and the count of every review, not of the page
      review/index.ts
      conversation/model/sides.ts  # "You" or the other person's name: the list and the thread both say who wrote
      conversation/index.ts
      notification/model/describe-notification.ts  # every kind as a title, a detail and a link
      notification/ui/notification-item.tsx  # one row, marking itself read on the way out
      notification/index.ts
    shared/                   # no domain knowledge: transport, routes, config
      api/http-client.ts      # apiRequest(), refreshSession(), the two errors
      api/auth.ts             # authApi, currentUser() — memoized, requireUser/requireRole
      api/session-cookies.ts  # the API's Set-Cookie, re-issued for this origin
      api/bookings.ts         # bookingsApi — the routes of the resource
      api/conversations.ts    # conversationsApi — threads and messages, every read personal
      api/listings.ts         # listingsApi — the same, for the catalogue rows
      api/users.ts            # usersApi — the admin's routes over accounts
      api/lookups.ts          # lookupsApi — what an id box suggests, abortable; optionOf for a page
      api/reviews.ts          # reviewsApi — a listing's (public), a guest's (scoped), write, remove
      api/keyset-page.ts      # a stale cursor onto null, the one both paged reads share
      api/notifications.ts    # notificationsApi — the caller's feed and its two marks
      api/server-events.ts    # the tab's one EventSource on /api/events, shared by listeners
      api/index.ts
      config/api-url.ts       # apiOrigin() and BFF_BASE_PATH
      config/routes.ts        # ROUTES — every path of this application
      config/cache-tags.ts    # the names the cached public reads are stored under
      config/cache-lifetimes.ts  # the one lifetime the API's own clock decides
      config/index.ts
      lib/form-errors.ts      # zod issues, API errors and field state onto one shape
      lib/use-action-form.ts  # the contract, react-hook-form and a Server Action, tied
      lib/next-path.ts        # a `?next=` that cannot leave this site
      lib/search-params.ts    # searchParams onto a URL and back: the domain-free half
      lib/dates.ts            # a calendar day is a YYYY-MM-DD string, read as UTC
      lib/money.ts            # a price onto the screen, in one place
      lib/not-found.ts        # a 404 from the API, and an id a URL cannot carry
      lib/plural.ts           # a count and the noun it counts, made to agree
      lib/lookup-option.ts    # a picked row as one line: the name, and the hint beside it
      lib/server-events/use-server-events.ts  # useServerEvents(listener) — a subscription per component
      lib/server-events/use-latest-count.ts   # one unread count off the stream, the newest revision winning
      lib/server-events/use-refresh-on-events.ts  # router.refresh() on the events a screen names, never piled up
      lib/badge-count.ts        # the number a badge draws, and the ceiling past which it stops
      lib/index.ts
      ui/back-link.tsx        # the way up from a detail screen to its list
      ui/button-link.tsx      # a <Link> wearing the button classes, spelled once
      ui/filter-field.tsx     # one box of a search form, spelled once
      ui/lookup-field.tsx     # an id box filled in by name: suggestions paged as they scroll
      ui/filter-select.tsx    # …and one that picks out of a closed set
      ui/form-field.tsx       # one box of a form that submits, and the aria that ties it
      ui/hint-label.tsx       # the label of a box or a group, its description a hint beside it
      ui/filter-form.tsx      # the `GET` form of a dialog, sent to the canonical URL
      ui/filter-chips.tsx     # what is applied, each chip a link that drops it
      ui/sort-select.tsx      # the orderings of a list, as one box
      ui/page-heading.tsx     # a list screen's title and the line under it
      ui/pager.tsx            # forwards-only keyset paging: next, and back to the first
      ui/stale-page-notice.tsx  # what a list shows for a cursor the API will not read
      ui/live-refresh.tsx     # router.refresh() on the event types a list names: the feed, the threads
      ui/refused-search-notice.tsx  # …and for a search the contract refuses
      ui/no-matches-notice.tsx  # …and for an answer the filters emptied
      ui/index.ts
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
- **Extraction.** "Start simple, extract when needed" holds literally —
  `fsd/insignificant-slice` is on and a slice appears the day a second consumer does, not
  the day it looks reusable. `features/save-listing` is the whole of that layer so far, and
  it was written the moment the second screen needed the form; `entities/user` appeared
  the day the account's own page became the second reader of the role labels.
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

## The shell

The frame around every page is `_app/layout`, and it is a sidebar beside the content
rather than a row of links above it: the navigation grew a section per role, and a header
is the wrong shape for a list that keeps growing.

- **`AppShell` reads the session once, for the whole frame.** The sidebar, the sheet
  behind the menu button and the header all render differently for a signed-in visitor,
  and each of them reading `/auth/me` would be three round trips for one answer — the
  transport gives up Next's per-render memoization in exchange for its timeout (see
  `http-client.ts`), so nothing collapses them by itself. What the shell asks for is
  handed down as a prop.
- **`currentUser()` is memoized on top of that** (`cache()` from React, in `shared/api`),
  which is what keeps the page under the shell from asking a fourth time. It takes no
  `ReadOptions`, unlike every other read of that segment: the session is personal, so
  `no-store` is the only answer a call site could give — and a function with no arguments
  is one `cache()` can key.
- **The footer is handed the session too**, and offers what the navigation offers: the
  catalogue to everybody, the stays only to somebody who has any. A link to `/bookings`
  left standing for a stranger is a click into `/login?next=/bookings` they never asked
  for, and the two halves of the shell disagreeing about one section is exactly the drift
  the single list below exists to stop.
- **One list of links, drawn twice** (`navigation.ts`): the sidebar from `lg` up, the
  sheet below it. Two lists would be two sets of role rules to keep in step, and those are
  exactly the rules that drift. It offers, it does not permit — every section behind a
  link answers the same way with or without one.
- **The icons are imported by both sides rather than passed between them.** A component is
  not data and cannot cross the RSC boundary, so `nav-links.tsx` computes the list itself
  from the plain `User` the server hands it. What it needs the client for is `usePathname`
  — which link is current is the one thing a server render cannot know about itself.
- **Signing out belongs to the shell**, which is why `LogoutButton` is a feature rather
  than a piece of the profile page: the account panel at the foot of the navigation runs
  it, and so does `/profile`. Why it is a browser call and not a Server Action is in "The
  session" below, and has not changed.

## Data and API

- **Every call to the API goes through `src/shared/api`.** No `fetch` to the backend from a
  component or a page: the transport — the base URL, the two errors, the parse of the
  answer — is written down once in `http-client.ts`.
- **The routes live next to it, one file per resource**: `shared/api/bookings.ts` writes
  down method, path and the schema of the answer for each of them. A new endpoint means a
  new method there, a new resource means a sibling file — never a `fetch` at the call site.
- **A query string is built there too, and it is sorted** (`queryString` in
  `http-client.ts`, used by `listingsApi.page` and `bookingsApi.page`). The URL is the key
  the Data Cache stores an answer under, so two callers asking the same question have to
  produce the same one or each of them warms an entry the other never reads. An absent
  filter is left out rather than sent empty. It lives with the transport rather than beside
  one resource because both paged reads spell it, and a second copy would be a second set
  of decisions about the blank and the ordering of the parameters.
- **A paged read answers a page, not a list**: `listingsApi.page` and `bookingsApi.page`
  both return `{ items, nextCursor }`, and the cursor is opaque here as well — it is handed
  back untouched, never taken apart. A `400` on a read that carried one is the only status
  either page slice recovers from, and it means the value in the URL was typed rather than
  followed.
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
- **A calendar day is a `YYYY-MM-DD` string, and `shared/lib/dates.ts` is the only place
  that turns one into an instant.** Midnight UTC is what each of them names, which is the
  clock `createBookingSchema` compares a check-in against. Parsing one into the runtime's
  own zone moves a stay by a day for anybody west of Greenwich and makes the server and
  the browser disagree about the same string — which React reports as a hydration error
  rather than as the bug it is. For the same reason "today" is computed on the server and
  handed to a client component as a prop instead of being read on both sides.
- **A count and the noun beside it agree in one place** (`shared/lib/plural.ts`).
  `countOf(nights, "night")` is what a screen writes; the comparison itself is spelled
  once. Four labels across three screens said it inline, and each of them was a place for
  a singular to be missed — the same argument as the formatter below. The irregular form
  is an argument rather than a guess, and the function is where `Intl.PluralRules` goes
  when i18n arrives.
- **Money is the currency itself, exact to the cent** (`shared/lib/money.ts`). Nothing is
  converted on the way to the screen — what the formatter adds is the second decimal a
  stored `120` does not carry and the rounding a multiplication needs, because three
  nights at 120.35 is `361.05000000000007` in binary floating point. It names its locale
  so the server and the browser agree on the separators. Every value that travels back to
  the API keeps the scale the contract gives it, and a box that takes a price steps in
  cents rather than leaving the browser to allow a third decimal the action would refuse.
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
  `register/api`) are the reason: cookies are written on the server, and the same contract
  schema refuses an obvious mistake before a request is spent. Whether the submit survives
  a page with no JavaScript is what tells the two apart — see "Forms" below. A login is the
  one form on a site that has to, and it is the one that keeps the plain `action={...}`.
- **Closing one is the exception, and the cookie scope is why**
  (`features/logout/ui/logout-button.tsx`).
  Revoking a refresh family means handing the API the refresh token, and only the browser
  is ever given one: it is scoped to `/api/auth`, so a Server Action — which posts to the
  URL of the page it sits on — never receives it. An action would clear the cookies of a
  family nobody revoked, and a stolen token would outlive the "Sign out" by a week. So the
  logout is a browser call through the BFF, followed by `router.refresh()`.
- **The login form's inputs stay controlled** even though the action reads the request
  rather than the state. React resets an uncontrolled form once an action settles, which
  would wipe what the visitor typed at the moment the message explaining it appears. The
  other forms have no such problem: `react-hook-form` owns their values, and an action that
  comes back with a refusal changes nothing about them.
- **The forms show what comes back under the same field names** —
  `shared/lib/form-errors.ts` maps a zod issue and an `apiErrorSchema` issue onto one
  shape, because they are the same thing on two sides of the wire. `fieldMessages` is the
  last step of it: every box of every form ends in the same line, and writing the map out
  at each of them is one more place to hand a field its neighbour's messages.
- **A `?next=` is a path of this site or it is nothing** (`shared/lib/next-path.ts`):
  `//evil.com` and `/\evil.com` are absolute URLs to a browser, and following one would
  make the login page an open redirect. The action checks it again after the page has:
  an action is an endpoint of its own, and this one ends in a redirect.

## Roles

The role arrives in the session (`/auth/me`) and decides two things on this side: which
screens are offered, and which one a visitor is shown. Neither of them is the access
check — the role is a claim of a signed access token, only the API holds the secret that
verifies it, and `RolesGuard` refuses every request on its own merits regardless of what
this side decided.

- **`requireRole(role, next)` is what a section of one role calls**, not a `currentUser`
  followed by a comparison at the top of each page. It is `requireUser` plus one
  comparison, and the argument is the same "where to come back to" a server render is
  never told about itself.
- **A wrong role answers `notFound()`.** The dashboard is the owner's own section; to
  everybody else it is a URL with nothing behind it, and a message explaining what they
  are missing would state that an owner's section exists and that they are not one.
- **Membership of a set, not a hierarchy**, exactly as the guard reads it in `apps/api`:
  an admin does not reach an owner's dashboard by being senior to an owner. `/listings/mine`
  is scoped to the caller, and an admin has no listings of their own to put on it.
- **The proxy cannot help.** It sees an httpOnly cookie it cannot open, so the gate in
  front of `/dashboard` is the same "is there an access token" it performs for `/profile`.
  A new protected route is still a line in the matcher of `proxy.ts`.
- **The header offers, it does not permit** (`_app/layout/header.tsx`). The link is
  rendered for the role that has a use for it; the section behind it answers the same way
  whether or not the link was there. So does a button inside a page: the "Cancel" on a
  stay is drawn for the guest who took it and for an admin, and an owner who may read that
  stay is not offered it — the API refuses them either way, and what is being decided here
  is what to put on the screen.
- **A page can have one scope per role rather than one page per role**, and `/bookings` is
  that case: `GET /bookings` narrows what it returns by the caller's role — a guest sees
  the stays they took, an owner the stays taken against their listings, an admin all of
  them — so the page has no filter to get wrong and the role only decides what to call the
  list. A `?guestId=` in its place would be a rule to re-check on every request.
- **The admin's section is `/admin`**, two screens: every listing on offer, each one
  edited and retired through the same `save-listing` and `delete-listing` features the
  owner runs, and `/admin/users`, the accounts, each leading to `/admin/users/[id]` — where
  a role is changed and an account blocked, and its stays and listings are one link away
  (`/bookings?guestId=`, `/admin?ownerId=`) rather than listed again. Both
  write actions send their author back to the section of their own role
  (`listingsSectionFor` in `shared/config/routes.ts`), read off the session rather than
  bound by the page — an action is an endpoint, and a destination it was handed would be
  one more value to distrust. The admin's own account page carries no controls:
  the API refuses a change to the caller's own account, and controls that could only
  reach that `403` are not worth drawing.
- **One link is current in the navigation**, the deepest one containing the path —
  `/admin` contains `/admin/users` as surely as the users link does.
- **Ownership of a row is read, not guessed** (`_pages/listing-edit/api/own-listing.ts`).
  Every signed-in role may read a listing — the catalogue is not a secret — so a row
  belonging to somebody else comes back with a 200 and would render a form the `PATCH`
  refuses. Inside the owner's own section that is the same 404 as a row that does not
  exist. The rule that matters still lives in `ListingService`, which compares the owner
  on every write.

## Forms

Two kinds, and what tells them apart is whether the submit has to survive a page whose
JavaScript never arrived.

- **The login form is the one that has to** (`_pages/login`). It stays a plain
  `<form action={submit}>` over `useActionState`: the browser posts `FormData` to the
  action with or without React, its boxes are controlled by hand so an action that comes
  back with a refusal does not empty them, and nothing validates it in the browser at all.
  A visitor who cannot sign in cannot use the site, so that form spends a round trip on a
  mistake rather than a dependency on hydration.
- **Every other form validates in the browser first** — registration, the listing form both
  dashboard screens run, the booking form. They are `react-hook-form` over the same
  contract schema the action parses, tied together by `useActionForm`
  (`shared/lib/use-action-form.ts`), and they submit through `onSubmit` rather than
  `action`, so the values travel as an object rather than as `FormData`. That is the trade,
  taken deliberately: a password policy stated a round trip after the fact is stated in the
  wrong place, and none of these screens is reachable by somebody who could not run the
  script that rendered it.
- **Registration asks for the password twice, and only while it is hidden**
  (`_pages/register/ui/register-form.tsx`). The second box is a question about what was
  typed behind asterisks, so the eye on the first one answers it: revealing the characters
  takes the box away and `unregister` takes its value with it, or a mismatch nobody can
  see any more would go on refusing the submit. It has no eye of its own — that would show
  a copy of what the box above is still hiding. The rule is `registerFormSchema` in
  `@repo/contracts`, beside the request schema rather than in the component: the
  confirmation never travels — the form hands `registerAction` the two fields the contract
  describes — but the sentence a visitor reads is worded where every other one is, and the
  field is optional there because its absence is exactly how the schema reads "the
  password is on the screen".
- **What a page with no scripts falls back to is `method="post"`, and it is not
  cosmetic.** A `<form>` with neither a `method` nor an `action` submits a `GET` to its own
  URL, so an unhydrated registration form would put the typed-in password into the address
  bar, the browser history and this server's access log. The attribute makes that failure a
  `405` from a page route that takes no `POST`, which is the right shape for it: nothing
  happens, and nothing leaks. With the script running, `handleSubmit` calls
  `preventDefault` before anything else and the attribute never comes up.

What `useActionForm` ties together, and what each third of it owns:

- **The schema is the contract's, and it runs twice.** `registerSchema`,
  `createListingSchema` and `createBookingSchema` refuse a field where it was typed and
  refuse the payload again inside the action — an action is an endpoint of its own,
  reachable by anything that can spell its id, so the browser's parse is a convenience and
  never the check. Nothing is validated in a component: a rule that is not in the contract
  does not exist.
- **A box is judged when it is left, and re-judged on every keystroke after that**
  (`mode: "onBlur"`, `reValidateMode: "onChange"`). Refusing a password at its first
  character is a message that stays wrong for as long as it takes to type a right one;
  leaving the message up after the mistake is gone is the other half of the same error.
- **What the server refuses is put back under the fields it names.** `FormErrors` is the
  same shape it always was, and the hook writes each message into field state with
  `setError` — so an API refusal and a schema refusal reach the screen through one line of
  markup. A name the form does not have is dropped rather than stored under a field nothing
  renders, and `defaultValues` is what says which names those are — it names the boxes, not
  everything the schema needs. What the schema needs and no box holds is `bound` instead
  (the listing a booking is taken against): it goes into the form's values so the browser
  parses against the whole contract schema rather than a narrower copy, and stays out of
  the list of names, because a refusal about a field with nothing on the screen would
  otherwise take the focus that belongs to the one the visitor can fix.
- **The first refusal takes the focus, and only the first.** Client-side that is
  `react-hook-form`'s own `shouldFocusError`; server-side it is `shouldFocus` on the first
  field the answer names. A form long enough to scroll otherwise reports a failure the
  visitor cannot see.
- **A form-level message is not a field's.** `FormErrors.message` — an unreachable API, a
  `409` about nights somebody else took — is rendered by the form itself in a `FieldError`,
  which is a `role="alert"` and therefore announced without being tied to a box.

**Every box is a `FormField`** (`shared/ui/form-field.tsx`), and it exists for the wiring
rather than for the markup:

- **`aria-invalid` and the message are linked by `aria-describedby`.** One says that a box
  is wrong and the other says what is wrong with it, and without the link a screen reader
  announces the first and never reaches the second. The ids are derived from the field name
  rather than being it, for the reason `FilterField` gives; the error's is left out while
  there is no error, because `FieldError` renders
  nothing at all in that case and a reference to an element that is not there reads as no
  description rather than as an empty one.
- **A description is a hint beside the label, never a paragraph under the box.** Every
  box and every group of boxes that explains itself does it through
  `shared/ui/hint-label.tsx`: `HintLabel` for a box — `FormField`, `FilterField` and
  `LookupField` draw it from their `description` — and `HintFieldSet` for a group with a
  `<legend>`, as the two price groups of the listing form are. A `FieldDescription` under
  a box or a legend is not written by hand, and neither is the aria of a group: the text is
  rendered twice, once in the popover and once visually hidden under the id `hintOf`
  derives, and that id goes into the control's `aria-describedby` — or the fieldset's,
  which `HintFieldSet` also points at the legend's text in `aria-labelledby`, because the
  icon inside the legend would otherwise join the group's name. Every id is derived from
  the one the component is handed, so no reference can name an element that is not there.
  What stays a `FieldDescription` is a note about the whole form rather than one of its
  boxes — the hold under the booking form, the resume under the login form.
- **A bound on the length is a count, never a `maxLength`** (`limit`, drawn by
  `shared/ui/character-count.tsx`). A hundred characters of a title is not a number anybody
  counts on sight, so the box says how much of its allowance is gone; what it does not do
  is take the rest away. `maxLength` is the one HTML constraint `noValidate` does not
  switch off, so it would stand in front of the contract exactly where every rule of a form
  here is the contract's to state — and it says nothing while it does it: a pasted
  paragraph loses its end in silence, where `A description may not be longer than 2000
characters` reaches the box either way. The number is read off the schema
  (`createListingSchema.shape.title.maxLength`) rather than written down again, and it is
  counted the way the schema counts it — trimmed — or it would promise room the parse then
  refuses. It subscribes by name in a component of its own, because whoever holds a
  subscription re-renders on every keystroke and that has to be one line rather than the
  whole form. Both spellings of it live there: `12 / 100` beside the box and a sentence for
  a screen reader, joined to the box through `aria-describedby` and announced when it takes
  focus rather than as it changes.
- **The value is rendered by the server.** `register` leaves a box uncontrolled and reaches
  the DOM through a ref, which runs after hydration — so the component passes
  `defaultValue` as well, or the edit screen would go out with four empty boxes and fill
  them in a moment later. It is the initial value and nothing after it, and it is read off
  the form once rather than on every render: from the first keystroke the value belongs to
  `react-hook-form`, and a default that moved along with it is what Base UI's
  `FieldControl` reports as a box turning controlled. The DOM would ignore the new default
  anyway — its own dirty-value flag goes up the moment the visitor types — so the only
  thing writing it again produced was the warning.
- **The control is a child function, not a prop.** The boxes differ — a password reveals
  itself, a description is several lines, a price steps in cents — and what surrounds them
  does not. Spreading what the function is handed is the whole of the wiring at a call
  site.
- **Text becomes what the contract wants at the box, not in the action.** `register`'s
  `setValueAs` is where a price and a capacity stop being strings, and an empty box becomes
  `undefined` rather than `0`: the schema then says the field is missing, which is what
  happened, instead of refusing a number nobody typed.
- **Every rule a person can break is worded by the contract, not by the screen.** A form
  validating in the browser makes zod's own wording the first thing a visitor reads, and
  `Too small: expected string to have >=3 characters` names the type system rather than the
  thing being asked for. So each of those rules carries an `error` where it is written —
  zod 4's spelling, which replaced the deprecated `message` — and the two codes a plain
  string cannot reach take a callback beside them instead: `numberMessage` in `listing.ts` and
  `dayMessage` in `booking.ts`, which is what tells a box left empty from text nothing could
  read. A form does not restate any of it, and the API answers with the same words.
- **A rule about a pair of fields waits until it has the pair.** `createBookingSchema`
  guards both of its refinements on the dates parsing at all, as `listingQuerySchema` does:
  without that, an empty check-in box is refused for being in the past — `"" >= today()` is
  false — and the visitor is told something untrue about a box they have not filled in,
  beside the refusal that is actually about it. Turning off `criteriaMode` would only hide
  it, since the API returns both issues and `toFieldErrors` collects them either way.
- **`noValidate` stays on every form**, for the reason the filter dialog gives: the
  browser's own validation would preempt the contract with messages of its own, in its own
  words and its own place.

**A form with no fields is neither of the two** — the confirmations behind a destructive
action (`delete-listing-button.tsx`, `cancel-booking-button.tsx`, `block-button.tsx`) submit a bound id and
nothing else, so they stay a plain `action={submit}` with nothing to validate. So does a
form whose only box is a closed choice — `role-form.tsx` on the admin's page of an account:
a select of the three roles cannot hold a value the contract refuses, so a browser-side
parse would have nothing to say, and the action still parses what arrives with
`updateUserSchema`. A form that gains a box somebody types into stops being this case.
So do the `GET` forms of the filter dialogs, which navigate rather than mutate; those are
the next section.

## Search, filters and the URL

The catalogue's filters live in the address bar and nowhere else. There is no filter state
in a component, because there is nothing for it to hold: the server renders from
`searchParams`, and every control on the screen either submits a form or is a link.

**The stays screen is the same shape over a different list** (`_pages/bookings`), and what
the two share sits in `shared`. In `shared/ui`: the box of a search form (`FilterField`),
the `GET` form of the dialog (`FilterForm`), the chips that take a filter off
(`FilterChips`), the ordering box (`SortSelect`), the forwards-only pager (`Pager`) and
the three notices a list shows in place of itself — a cursor the API will not read
(`StalePageNotice`), a search the contract refuses (`RefusedSearchNotice`) and an answer
the filters emptied (`NoMatchesNotice`). The two admin lists are the same shape again:
`_pages/admin-users` over accounts, and `_pages/admin-listings` over the catalogue's own
filters plus `ownerId` — the one the catalogue's contract takes and only an admin has a
use for, shown as a chip named by the owner's name and address. In `shared/lib`
and `shared/api`, the domain-free mechanics the two slices' search modules would otherwise
each spell: `filtersHref` and `singleParam` and `searchParamsHref` (`search-params.ts`),
`dayLabelOrAny` (`dates.ts`), `messagesExcept` (`form-errors.ts`), `pageOrNullOnStaleCursor`
(`api/keyset-page.ts`).

What is _not_ shared is anything that knows what is being filtered — the field set, the
labels, the schema wiring, `readXxxSearch`, `sortOptions`, `activeFilters` — and that
stays in the slice of each screen, which is why `catalogue-search.ts` and
`bookings-search.ts` are two files rather than one generic one. The line is the same one
`FilterForm` draws with `href` as a prop: the slice hands over what it knows (the route,
the field order, the labels) and the shared half does the assembling. A generic
`createKeysetSearch(config)` was weighed and left out — it trades ~50 lines a reviewer
checks by reading them once for a parameterised type that is harder to read than either
copy.

The exception is two screens over the _same_ contract. The catalogue and the admin's
listings both put `listingQuerySchema`, so its half of the job — the boxes
(`ListingFilterFields`), the chips (`listingFilterChips`), the orderings and their labels
(`listingSortOptions`) — lives once in `features/listing-search`, and each slice hands it its own
link builder. What stays in the slices is what differs: the route, `readXxxSearch`, and
`ownerId`, the admin's extra filter. That also means a spec of either search module
imports a component through the feature's public API, which is why `vitest.config.ts`
compiles JSX although nothing is rendered.

The `shared/ui` components are there rather than in `@repo/ui` because none of them is a
primitive: one speaks this application's `FieldErrors` and ends in its `fieldMessages`,
another navigates with `useRouter`. What they compose — `Field`, `Input`, `Badge`,
`Select`, `Empty` — is what lives in the design system.

The rules below are written about the catalogue and hold for both, with two differences
worth naming: the stays are personal, so that read is `no-store` and carries no tag; and
`listingId` is also reached by a link on a card, which fills the box in through the URL.

**An id filter is filled in by name** (`shared/ui/lookup-field.tsx`) — `ownerId` on the
admin's listings, `listingId` and `guestId` on the stays. Nobody remembers a uuid, so the
box is a combobox over `/lookups/*`: three characters of a name or a title are a
search, a whole uuid is the one row it names, and what is picked travels in a hidden input
as the id it always was — the URL, the contract, the chips and the canonical address do not
know the box changed.

- **The suggestions are the API's to scope**: each lookup answers with the rows its filter
  can match for this session, so a suggestion is never a filter that empties the list.
- **One request per pause, never one per letter**: the box waits 300 ms, and a keystroke
  aborts whatever the previous one was waiting for (`signal` on `apiRequest`, joined with
  the transport's timeout by hand — `AbortSignal.any` is newer than the browsers Next
  targets). An abort, before the headers or while the body streams, arrives as
  `ApiUnreachableError`.
- **The list pages as it scrolls**: twenty at a time, the next page asked for with the
  cursor the API handed back when the list nears its end — three letters can be half the
  site's accounts. One page at a time: a ref guards the request, because two scroll events
  can arrive before the render that shows it.
- **A row the URL names only by id is named by the page, on the server** (`valueOption`):
  `lookupsApi.optionOf` asks the same lookup by the whole id once per render, beside the
  list, and the chip reads the same name. Not the box — the dialog mounts it anew each time
  it opens, and each opening would ask again. Where nothing answers, the box shows the id.
- **Typed text that was not picked is submitted as it was typed**, a pasted id included: the
  contract then answers it under the box, rather than the filter staying what it was. The
  box keeps that text when its popup closes, which Base UI would otherwise reset to the
  name of what was picked. A value the contract refused stays as it was typed, like in
  every other box.
- **It is a browser call by nature** — it runs on keystrokes in a box already on the
  screen — and the dialog it lives in already needs JavaScript, so it costs nothing that
  compact toolbar had not already spent.

- **Every filter is a modal** (`catalogue-filters-dialog.tsx`), and the toolbar above the
  list is two controls: the button that opens it, with a count of what is applied, and the
  ordering. The screen is the chips and the stays, not a panel of boxes.
- **The form inside it is a `GET` form** (`shared/ui/filter-form.tsx`, drawn by both
  dialogs). Submitting it writes the filters into the URL and the browser goes there, so
  the dialog needs no action and nothing to keep in step with the boxes: the values come
  back out of the address the server rendered from.
- **Where there is JavaScript, that form navigates to the canonical address itself.** A
  `GET` form submits every box it has, so the address it lands on is the long one below
  and the page replaces it a round trip later — which the address bar shows, and a
  commercial screen should not. So `onSubmit` builds the link out of the submitted fields
  with the very function the chips and the ordering write theirs with
  (`catalogueHref` / `bookingsHref`) and pushes it. The fields are read as they were
  submitted rather than merged into the search on the screen, and trimmed the way
  `singleParam` trims what it reads back: either would be a value that canonicalises to
  something else, and the redirect would run after all.
- **The redirect underneath it stays load-bearing** — it is what canonicalises a submit
  with no JavaScript behind it, and a URL somebody typed or shortened by hand. The client
  path is the fast one over it, not a replacement, which is why the form keeps its
  `method` and its `action`: without a script it is exactly the form it was.
- **What the dialog holds is open state and nothing else.** A document navigation used to
  close it by taking the page away, and a soft one leaves it standing — so the submit and
  the "Clear all" beside it close it themselves. The boxes are uncontrolled, so a popup
  left open would go on showing filters the address no longer carries.
- **It carries `noValidate` like every other form here**, and this one has the sharper
  reason. The boxes state `min` and `step` so the keypad offers the right thing, and the
  browser would otherwise refuse a submit over them in its own words and its own place,
  before `listingQuerySchema` has said anything. A search arrives out of a URL, so a value
  the contract refuses reaches this dialog already filled in — and a submit the browser
  blocks would leave a visitor with a box they cannot correct by pressing the only button
  in front of them.
- **One search, one address** (`canonical` in `lib/catalogue-search.ts` and in
  `lib/bookings-search.ts`, the `redirect` at the top of each of the two pages). A `GET`
  form submits every box it has, so the dialog
  lands on `?from=&to=&minPrice=100&…` — the same search a chip writes as `?minPrice=100`,
  and `listingQuerySchema` reads the blanks as the absences they are, so both are answered
  identically. Two addresses for one answer is what the redirect exists to stop: a link
  longer than the search it carries, a second entry in the router cache for a page already
  there, and a pair of URLs a crawler reads as duplicates. The page redirects before it
  asks the API, so the cost is a redirect rather than a fetch, and a search the contract
  refuses is canonicalised too — the boxes showing the mistake belong at the address it
  will be corrected at. The stays screen buys less by it — that read is `no-store`, so
  there is no cache entry to split and no crawler to confuse — and does it anyway, because
  a screen of this shape answering the same question at two addresses is the drift the
  rule exists to stop.
- **The canonical address is the filters and nothing else**, which is what makes it
  comparable: it is the link `catalogueHref` would have written, so the parameters are in
  its order, a repeated one is gone with the value it stood for, and a parameter this
  catalogue does not take is dropped. A campaign tag on a link into the catalogue does not
  survive that, and would have to be carried deliberately if one ever appears. The redirect
  is temporary rather than permanent for the same reason: which addresses collapse into
  which is a decision of this slice, and a 308 would be cached by the browser for good.
- **What that costs is a search without JavaScript.** A dialog and a `<select>` both need
  it, so a visitor whose scripts never arrive can read the catalogue and take a filter off
  a search somebody sent them — a chip is still a link — but cannot ask a question of their
  own. That is the trade the compact toolbar is, and it is the one thing to weigh before
  moving another control behind a door.
- **The boxes are one field component** (`filter-field.tsx`), and it derives the `id` from
  the field name rather than taking it as a prop: the boxes are portalled into the dialog,
  and a label pointing at a bare `from` would follow whatever else on the page carries
  that id.
- **A chip is a link that removes one filter** (`active-filters.tsx`, `activeFilters` in
  `lib/catalogue-search.ts`). Removing a filter is another address, so it needs neither
  JavaScript nor an action, it survives a reload, and Back undoes it.
- **The dates are one chip, not two.** `listingQuerySchema` refuses half a range, so a
  chip that took away only the check-in would write a link the catalogue cannot answer.
- **The ordering is a select over the same four links** (`catalogue-sort.tsx`,
  `sortOptions` in `lib/catalogue-search.ts`). Choosing one navigates to the address that
  option writes, so it is still a value of the URL: it can be sent to somebody else and
  Back undoes it. The set comes from `listingSortSchema.options`, so a fifth ordering
  added to the contract appears in the box with a label and nothing else to remember. Each
  option drops the cursor, and has to: the API issues one under the ordering it was asked
  for and refuses it under another.
- **The default ordering leaves no trace in the URL.** `newest` is what the contract picks
  for a catalogue nobody has asked anything of, so the link to it is the bare `/listings`
  rather than `?sort=newest`. An ordering the contract refused marks no option as chosen —
  the parse has already refused the search, and the message under the box says so.
- **Sorting is not a filter**, and two places say so: it gets no chip — there is no
  unordered catalogue to fall back to — and "Clear all" keeps it (`clearedFiltersHref`).
  What it does travel in is every link this slice writes and the dialog's form, as a hidden
  box beside the prices: a form submits every field it has, so without one showing the
  stays would put them back in the order they were published.
- **A filter the contract refused is still shown as it was typed.** It came out of a URL
  like every other one; the parse has already refused the search, and the chip is what
  lets a visitor take the refusal off again.
- **A value a box cannot show is still reported.** Every box lives inside the dialog now,
  so every message about one is repeated in the toolbar — a refusal behind a closed door
  is a page that looks broken for no stated reason.
- **An empty screen says which of the three emptied it**, and only the first of them is
  the same sentence on both lists. A search nothing matched is a filter away from an
  answer, so it is `NoMatchesNotice` and it points at the chips — the way out is already
  on the screen. A list with nothing in it at all is not: an empty catalogue and a guest
  with no stays are each a message about that list, written in its own slice, and the one
  that can offer a first step does (`ROUTES.catalogue`). The third is the search the
  contract refused, which reached no API at all — `RefusedSearchNotice`, next to the
  messages under the boxes. Telling a visitor to widen a filter when there was none is
  what the split exists to stop.
- **Which of the two the list is showing is one read** — `activeFilters(values)` in the
  page, handed to the toolbar as a prop. The toolbar counts it on the button and draws it
  as chips while the empty state asks whether it is empty, and two calls would be two
  chances to answer the same question differently.

## Live updates

The API pushes over one stream per browser — `GET /events`, Server-Sent Events, read
through the BFF at `/api/events` — and everything live on this side listens to that one
stream.

- **One connection, many listeners, many tabs** (`shared/api/server-events.ts`). The first
  `useServerEvents` of a tab joins and the last one to unmount quits. Across tabs, the one
  holding a `navigator.locks` lock opens the `EventSource` and passes every event to the
  others over a `BroadcastChannel`; the others queue for the lock and the next one takes
  over when the leader quits or closes. A browser holds six connections per origin over
  HTTP/1.1 for all its tabs together, so a stream per tab would queue the whole site behind
  six tabs. A feature that wants live data adds a listener and a member to
  `serverEventSchema`, never a second stream — the messages between users did exactly that.
- **Every listener starts with a `sync`.** The connection's own, or one built from the
  latest count the tab knows of for a listener that arrives later — or, for a joining tab
  whose first news from the leader is an ordinary event that overtook the `welcome`, from
  that event's counts — so a first `sync` means "the state now" and a later one "there
  was a gap" (`useRefreshOnEvents`, behind `LiveRefresh` on the feed and the threads and
  `LiveThread` on an open thread, redraws on the second kind). A burst of events while a
  render is in flight asks for one more render after it rather than one per event.
- **The browser reconnects by itself after a drop, and gives up on a non-`200`** without
  saying which. The API closes every stream after five minutes so the reconnect passes its
  guard again, and by then the access token may have lapsed. A stream the browser gave up on
  is answered with one ordinary request — `GET /notifications/unread-count`, which refreshes
  the session through the transport if it gets a `401` and does nothing else otherwise —
  and a reconnect that waits twice as long with every failure in a row, up to five minutes,
  until a connection opens. Refreshing blindly would rotate the session every two seconds
  against a route that answers `404` or `500`. Each delay is drawn from the upper half of
  its range, so browsers refused together by a restarting API do not return together, and
  the window's `online` event drops the delay and reconnects at once.
- **Counts are absolute, not deltas, and ordered by revision.** Every event carries both
  unread counts — `unreadNotifications` and `unreadConversations` — and every connection
  opens with a `sync`, so the bell and the badge beside Messages take the number they are
  given and never count for themselves. The bell's count also arrives in the answers to this
  tab's own reads, and two roads do not keep each other's order: each count carries its
  `unreadRevision` — one sequence for both counts — and each of them keeps the highest. That
  rule is written once, in `useLatestCount`, and so is the badge's ceiling (`badgeCount`).
  Below `lg` the badge is behind the closed sheet, so the menu button carries a dot of its
  own and says the count in its name.
- **The BFF streams this one answer.** Everything else is buffered and cut off after nine
  seconds; a `text/event-stream` is handed on as it arrives, the deadline covers its
  headers only, and the browser leaving is what aborts the upstream request.
- **The bell is the shell's** (`_app/layout/notification-bell.tsx`) and renders for a
  session only. Its count comes from the stream rather than the server render — one number
  should have one source — and its list is read when the popup opens. A new notice is
  announced with a toast (`toast` is re-exported by `@repo/ui/components/sonner`, beside
  the `Toaster` that draws it).
- **The wording is `entities/notification`**: the bell, the toast and `/notifications` all
  draw a notice, and `describeNotification` is an exhaustive switch over the contract's
  types, so a new kind stops compiling there. Steiger cannot see the shell as its second
  consumer — the `features/logout` case — and its `insignificant-slice` is off for it.
- **A message is not a notification.** It reaches the stream as `message.created` (to both
  sides of the thread) and `conversation.read` (to the reader's other tabs), never as a row
  on the bell. The list of threads redraws on either, an open thread on a message of its
  own it has not drawn yet — the one this tab just sent is already there. The reply box is
  not keyed by anything the page drew: it empties itself through `useActionForm`'s
  `onSuccess` when the action answers `NO_FORM_ERRORS`, so no re-render — a live reply, a
  message from another tab, a turn to an earlier page — can wipe a draft.
- **An open thread is marked read only once its end is on the screen, and only while its
  tab is visible** (`mark-read.tsx`). The page opens at its top, so the newest message of a
  long page sits below the fold: an empty mark after the list waits for an
  `IntersectionObserver`. The thread re-renders on every message, in a background tab too,
  and a mark from there would put the badge out for a message nobody saw; a hidden tab
  waits for `visibilitychange`.
- **Marking one read is a browser call**, made on the click of the link, because the click
  is a navigation and must not wait for an action; marking all read on the feed page is a
  Server Action plus `refresh()`. Either way the API publishes the new count, and every tab
  of the account hears it.

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
- **A tag does not cache anything by itself, so `revalidate` is not optional.** A `fetch`
  has not been cached by default since Next 15: the decision is read off `cache` and
  `revalidate`, and a request naming neither becomes a `no-store` with its tags attached
  to nothing — `{ next: { tags } }` looks like caching and is not, and the mutation
  invalidating that tag then has nothing to invalidate. It fails by being fresh, which is
  why nothing reports it. `ReadOptions` requires the field for that reason, and a read
  whose only invalidation is its tag says `revalidate: false` — `listingTag(id)` and
  `listingReviewsTag(id)` are that case, while the two reads a lapsing hold changes carry
  the minute below instead.
- **`revalidate: false` trusts that every write goes through a Server Action here.** A
  row changed around the frontend — `db:seed`, `psql`, a call straight to the API — names
  no tag, so the cached answer outlives it until the Data Cache is cleared (`rm -rf
apps/web/.next/cache`, or a new deploy). After a re-seed that is the listings and their
  reviews: the pages keep drawing the previous data until then. That is the trade of a read with no lifetime, made deliberately — nothing in the
  API writes these rows on its own, unlike the holds below.
- **The names live in `shared/config/cache-tags.ts`**, for the same reason `ROUTES` does:
  a tag is a string a read and a mutation have to spell the same way, and a typo in either
  half is a page that never updates or one that updates for nothing.
- **A tag is named after what a write changes, not after what a read shows.** There are
  four — `CATALOGUE_TAG`, `listingTag(id)`, `availabilityTag(id)`, `listingReviewsTag(id)` —
  because editing a listing changes the row and the catalogue but not who has booked it, and taking a
  booking changes what is free without touching the row, and a review changes neither.
  Tagging the availability with the row's tag would make every edit refetch every
  calendar and every booking refetch every row.
- **A read whose answer changes on a timer needs a lifetime as well as a tag**, and the
  two reads a hold affects are the case. A `PENDING_PAYMENT` hold lapses fifteen minutes
  after it was taken and puts its nights back on offer; nothing on this side mutates when
  it does, because the API releases it from a queue. So the catalogue and the availability
  carry `next: { revalidate: HOLD_SWEEP_REVALIDATE, tags }` — a minute, which is the
  interval of the sweep behind that queue rather than a number picked for the feel of it.
- **That minute is named in `shared/config/cache-lifetimes.ts`**, and for the same reason
  the tags next door are: it is `SWEEP_INTERVAL_MS` of `apps/api/src/booking/booking-expiry.queue.ts`
  read from this side, and nothing across the wire checks that the two still agree — a
  literal at each call site is one more place to miss when that interval changes. Only a
  lifetime the API's own clock decides goes in there. A number chosen by this side for one
  screen stays at that screen, and `revalidate: false` is not a lifetime at all — it is
  how a read says its tag is the whole of its invalidation, and a name would only hide
  that.
- **Both halves of a write, in that order**: `updateTag` for the tag the author is about
  to read, `revalidateTag(tag, "max")` for the tags everybody else reads. The first makes
  the next request wait for a fresh answer, which is what stops an author's own save
  reading as lost; the second serves the previous answer while a new one is fetched
  behind it, which is what the rest of the site should get. `refresh()` after them is a
  third thing again — it throws away the router cache in the browser that made the
  request, and is what a `no-store` read needs, since none of it is in the Data Cache.

### Confirming a destructive action

A mutation nobody can undo — deleting a row, revoking access, anything the API answers
with a `DELETE` — asks first, in an `AlertDialog` from `@repo/ui`
(`features/delete-listing/ui/delete-listing-button.tsx`,
`features/delete-review/ui/delete-review-button.tsx`,
`_pages/bookings/ui/cancel-booking-button.tsx` and `_pages/admin-user/ui/block-button.tsx`). Not a second
button that takes the place of the first: a modal takes the focus and refuses a click
outside itself, which is what stops the confirmation being hit by the hand that was
already moving.

- **The form goes inside the popup**, not around it. The popup is portalled out of the
  subtree that renders it, so a submit button left behind in a form up here stops
  belonging to that form. `className="contents"` on the `<form>` keeps the grid of the
  dialog intact around it.
- **Its trigger never sits inside another form**, even though the popup leaves the DOM
  subtree. React bubbles a submit along the component tree, portals included, so the
  confirmation's own submit would reach the outer form's `onSubmit` as well. Where a
  delete shares a row with a form's buttons, the row goes outside the `<form>` and the
  submit reaches it through the `form` attribute (`extraAction` in
  `features/save-listing/ui/listing-form.tsx`).
- **The dialog stays open when the action comes back with a message.** A refusal the form
  could not prevent — a `404` for a row an admin retired first or for a hold that lapsed
  while the dialog was open, an unreachable API — belongs next to the button that
  provoked it, under the same `FormErrors` shape every other form shows.
- **A success does not have to redirect.** Deleting a listing does, because the screen it
  was on is now a 404; cancelling a stay does not, because the row belongs exactly where
  it is and only has a different status. What that one returns is `NO_FORM_ERRORS` and a
  `refresh()`, and the list re-renders behind the closing dialog.
- **What is reversible does not ask.** Signing out is a click away from being undone, and
  a dialog in front of it only adds one. The rule is the undo, not the danger of the word.

## Waiting, and failing

- **A route that reads the API has a `loading.tsx`**, and it is a one-line re-export like
  every other file in `app/`: the skeleton itself is a component of the page's own slice.
  What it draws is the shape of the screen it precedes, so nothing jumps when the answer
  arrives.
- **`not-found.tsx` is reached far more often than by a mistyped URL.** Every id that
  cannot name a row arrives there (`requireId`, `orNotFound`), so does a retired listing,
  and so does an owner's section opened by somebody who is not one.
- **Two error boundaries, because they catch different things.** `error.tsx` catches what
  a page throws; it cannot catch what the layout above it throws, and this shell reads the
  session before it renders anything — so an API that cannot be reached at all fails
  there. `global-error.tsx` is that case, and it replaces the document, which is why it
  brings its own `<html>`, `<body>` and token import. Next.js decides from the file itself
  whether a boundary is a Client Component, so both of those `app/` files carry the
  directive as well as re-exporting one.
- **Neither of them explains the failure.** What reaches a boundary is a drift from the
  contract or a 500, and both are for the console. The two failures a visitor can act on
  are already messages beside the form that provoked them.

## Styling and components

Tailwind CSS 4 with shadcn/ui on top of Base UI primitives. The components are **generated
into `@repo/ui`**, not installed as a dependency — they are ordinary source files of this
repository and are edited like any other code. `@repo/ui` is the design system; it plays
the part `shared/ui` plays in a single-package FSD project, and a primitive belongs there
rather than in `src/shared`.

`src/shared/ui` exists for what a second screen needs and the design system cannot hold: a
component that knows this application's `FieldErrors`, or one whose whole job is to
navigate with `useRouter`. The test is the dependency, not the size — anything that would
have to import from `#shared/*` or from `next/*` is not a primitive and does not go into
the package. Thirteen live there: `PageHeading` — the title and the line under it at the top of
a list screen —, `BackLink` — the ghost arrow link above a detail
screen's heading, back to the list it was opened from —, `ButtonLink` — a `<Link>` wearing the button classes, the
one spelling of "a link that looks like a button" (see below) —, `FormField`, the one box
every form that submits is made of, and `FilterField`, `LookupField`,
`FilterForm`, `FilterChips`, `SortSelect`, `Pager`, `StalePageNotice`,
`RefusedSearchNotice` and `NoMatchesNotice`, the parts the
catalogue and the stays screen search and page with. A component only one screen uses
stays in that screen's slice, exactly as "pages first" says.

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
- **A link that looks like a button is a `<Link>` wearing the classes**, not a `Button`
  rendering a link. That spelling — `cn(buttonVariants({ variant, size }), className)`, so
  `tailwind-merge` resolves a screen's own class the way it does inside the primitive —
  lives once in `ButtonLink` (`shared/ui`), and a call site writes
  `<ButtonLink href={...} variant="ghost" size="sm">`: `variant` and `size` are the
  button's, everything else is `next/link`'s. `Button` keeps
  the `nativeButton` promise of Base UI — that what its `render` prop produces is a real
  `<button>` — and an `<a>` in there breaks it: the console says so in development, and
  what it costs is the form and accessibility semantics of the element.
  `nativeButton={false}` silences the message and is still the wrong shape here — it puts
  button behaviour on a link rather than leaving a link a link. So the rule is by intent:
  navigation is an anchor, an action is a `Button`. Every trigger that composes one
  (`DialogTrigger`, `AlertDialogTrigger`) is unaffected — a `Button` inside one is still a
  `<button>`.
- **A run of the same row is a list, and says so.** A `map` over data of any length —
  the catalogue's cards, the owner's dashboard, a visitor's stays — renders
  `<ul role="list">` with one `<li>` per row, and the layout classes stay where they
  were: a grid or a flex column behaves identically on the `<ul>`. What that buys is a
  count and an edge — a screen reader announces how many rows there are and where one
  ends, which a run of `div`s cannot say, and these rows are alike by design. What it does
  not buy is search ranking: nothing reads list markup for that, and what would read a
  catalogue is structured data this site does not emit yet. `role="list"` is not
  redundant — Tailwind's preflight drops the marker from every `ul` and Safari drops the
  list semantics along with it, so the attribute is what puts them back.
- **What is not a collection is not marked as one.** A set written down in the code is a
  composition rather than a list: the toolbar's controls, the home page's three
  highlights, the weekday headings of the calendar. So is the row of chips under the
  toolbar — each one is a control that takes a filter off, and it belongs with the
  controls beside it rather than in a collection of its own. Their number is not something
  a visitor needs announced, and the markup would only be more to read past.
- The theme is `next-themes` with the class strategy (`src/_app/providers/providers.tsx`). A
  component that reads the theme renders on the server too — hence the `mounted` guard in
  `src/_app/layout/theme-toggle.tsx`.
- No CSS Modules and no other styling libraries. The only hand-written CSS is the token
  file in the package.

## Checks

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

Three rules are switched off there, each with the reason next to it, and all three are the
same renaming showing through: `typo-in-layer-name` for `_app` and `_pages` (Steiger has
no setting for the renaming the Next.js guide prescribes, and reads the prefix as a
misspelling), `no-segmentless-slices` inside `_app` (it reads that prefixed layer as a
sliced one and asks each segment to be divided again), and `insignificant-slice` for
`features/logout` alone (the rule counts references between slices, and the shell's
account panel is a segment of a layer Steiger reads as sliceless — so the second consumer
of that slice is invisible to it). Everything else is on, `insignificant-slice` for every
other slice included — that one is what keeps "pages first" honest. Do not silence
anything else without writing down why.

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
because that was where this logic lived until the catalogue arrived — the specs in
`_pages/` are the same four kinds, on a layer rather than in a layer. None of them is a
component:

- A parser of untrusted input — `shared/lib/next-path.ts` (where a visitor is sent after
  signing in), the `Set-Cookie` reader inside `shared/api/session-cookies.ts` (what
  becomes a cookie of this origin) and the two searches — `_pages/catalogue/lib/catalogue-search.ts`
  and `_pages/bookings/lib/bookings-search.ts`
  (`searchParams` onto the contract's query: what a blank box means, what a repeated
  parameter means, that the link the page writes parses back to the search it came from,
  that the address it redirects to is one it would leave alone — a canonical form that is
  not a fixed point is a redirect loop —,
  what each chip's link takes off — a chip that dropped the wrong half of a date range
  would write a link the catalogue answers with a refusal — and what the ordering's own
  links carry, since one that lost a filter or kept a cursor would answer a different
  question than the one on the screen).
- A security gate — `_app/proxy/proxy.ts`, which decides whether a request reaches a page
  or is bounced to `/login?next=…`.
- A concurrency or protocol invariant — the single-flight session refresh and the
  retry-one-401-once rule in `shared/api/http-client.ts`, and the event stream's protocol in
  `shared/api/server-events.ts` (one stream per browser and its handover between tabs, the
  growing delay before a refused stream is tried again, the `sync` every listener starts
  with): each has a real way to be wrong (a second rotation spent on an already-refreshed
  session, a retry loop) that only shows up under a race or a specific server answer, not
  by reading the function.
- A mapping with more than one rule to keep straight — `shared/lib/form-errors.ts` (a zod
  issue, an `apiErrorSchema` issue and `react-hook-form`'s own field state reduced to one
  shape: which of `types` and `message` a box's messages come out of, and that a rule
  recorded as a bare `true` is not one of them), `shared/config/api-url.ts`
  (the trailing slash, the missing-env failure, the module-level cache) and
  `_pages/listing/lib/months.ts` (the half-open range the calendar shades, the month
  rollover, the Monday-first offset — a stay's check-out day drawn as taken would be a
  free night the screen refuses to sell). What a night of a stay costs is not here: the
  booking form quotes by `nightlyPrice` from `@repo/contracts`, and its spec lives there,
  because the payment has to charge by the same rule.

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
