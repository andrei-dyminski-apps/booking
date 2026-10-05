# Project roadmap

The goal is to bring this pet project to a state that demonstrates production-grade engineering decisions to an employer: a contract shared by the frontend and the backend, honest authentication, a payment cycle with webhooks and correct handling of concurrent access at the database level. Every phase ends with a working, demonstrable feature and its own PR into `main`.

## Target architecture

```
apps/web  (Next.js 16)  ──HTTP──▶  apps/api (NestJS 11)  ──▶  PostgreSQL (Prisma)
     │                                  │                         │
     │  @repo/contracts (zod)           ├──▶ Stripe (PaymentIntent + webhook)
     └────── the shared contract ───────┘
                                        └──▶ Redis + BullMQ (hold expiry, emails)
```

The domain model (grown phase by phase):

- **User** — `id, email, passwordHash, role (USER | OWNER | ADMIN)` — phases 2–3
- **Listing** (a place to stay) — belongs to an OWNER, has a nightly price — phase 3
- **Booking** — `status: PENDING_PAYMENT | CONFIRMED | CANCELLED | EXPIRED`, `expiresAt`, `paymentIntentId`, a date range — phases 1 → 4 → 5
- **Review** — optional, phase 7

## Layering inside `apps/api`

The default of the repository stays a modular monolith, now with the
`module → controller → service → repository → Prisma` layering described in
`apps/api/CLAUDE.md`. One departure from it is planned, and only one.

**Everywhere: a repository between the service and Prisma — done.** No service imports the
generated client or the row types any more (the mappers live in the repository), so a unit
test fakes a repository instead of a query builder. It is a rule now rather than a
judgement call: `auth`, `booking` and `listing` all have one, and so does the next module.
Cheap, and it is the step the market means when it asks for "clean architecture".

**In `booking` only: ports and adapters.** Once phase 4 and the payment cycle of phase 6
land, that module is the one that earns the full
`domain / application / infrastructure / presentation` split:

```
booking/
  domain/            # status transitions, date range, refund rule — no Nest, no Prisma
  application/
    ports/           # BookingRepository, PaymentGateway — interfaces
    *.usecase.ts     # create / confirm / cancel / expire holds
  infrastructure/    # PrismaBookingRepository, StripePaymentGateway, BullMQ jobs
  presentation/      # controller, Stripe webhook controller, dto
```

What justifies it there and nowhere else:

- **Rules that are pure functions**: which status transition is legal, what a cancellation
  refunds 48 h before check-in, what a stay costs. They belong in `domain/`, where they are
  tested without a database and without the network.
- **Three entry points into one piece of logic**: HTTP creates a booking, the Stripe webhook
  confirms it, a BullMQ job expires the hold. That is what makes `application/` a layer
  rather than a formality — with a single entry point it would be one.
- **Two external worlds**: Postgres and Stripe. `PaymentGateway` as a port is what makes the
  "e2e over the whole cycle, Stripe mocked" of phase 7 an architectural property instead of a
  hack inside the test.

The transaction with `SELECT ... FOR UPDATE` and the `EXCLUDE` constraint of phase 4 stay in
the repository adapter. That is not a leak: guaranteeing integrity is the infrastructure's
job, and the domain only ever sees the conflict it raises.

The modules that deliberately keep the plain layering:

- **`auth`** — argon2, JWT, cookies and rotation are infrastructure and security, not a
  domain. Ports there would be interfaces with one implementation forever. It gets the
  repository step and nothing more.
- **`listing` / the catalogue (phase 5)** — read-heavy CRUD with filters and pagination. It
  has the repository like every other module; what it does not get is a domain model, which
  would only stand between the query and the projection the list needs.
- **`review` (phase 7)** — CRUD: the repository and nothing more.

The rollout follows the phases: `auth` took the repository step at the end of phase 2, where
it was cheapest — its backend was finished and phase 3 only adds guards on top; `booking`
took it at the end of phase 3, one phase earlier than planned, because the rules arrived
earlier than the transaction did: the scope of a list and the right to cancel a row are
already rules worth testing on their own, and the foreign key violation the pre-flight
check cannot avoid needed a side of the wall to be translated on; `listing` took it right
after, when the step became the rule for every entity rather than something a module had to
earn — and phase 5 put the catalogue's filters, its keyset page and the availability read
into the two repositories that were already there, without either module growing a layer.
Phase 4 added the locking transaction to the repository that was already there and
`booking/domain/` with the statuses; the ports and the use cases follow when Stripe arrives
in phase 6. Introducing the layers before the rules exist would be a refactor of a CRUD,
which is exactly the overengineering an interviewer notices.

## Layering inside `apps/web`

The frontend is organized by **Feature-Sliced Design**. Routing stays with Next.js: `app/`
holds nothing but one-line re-exports, and the code lives in `src/`, where the two layers
whose names the framework has taken are prefixed the way the FSD guide for Next.js
prescribes.

```
app/                 # layout.tsx, page.tsx — re-exports of a slice
src/
  _app/              # the shell in segments: layout, providers, styles, fonts
  _pages/            # one slice per route, with everything that route needs
  features/          # a user action a second page also runs (the listing form)
  entities/          # a domain model a second page also needs (empty for now)
  shared/            # no domain knowledge: the API transport and routes, config
```

The layer list follows v2.1 rather than the older six-layer picture: `widgets` is not
adopted, CRUD over a resource stays in `shared/api`, and a slice is extracted the day a
second consumer appears — not in anticipation of the screens of phase 5.

What the methodology buys here, and what it costs:

- **A dependency rule that is checked, not agreed on.** A layer imports downwards only and
  never a sibling slice of its own layer. The `imports` map resolves `#_pages/home` to that
  slice's `index.ts`, so a deep import cannot be spelled, and Steiger
  (`apps/web/steiger.config.js`, part of `pnpm lint`) fails the check on everything the
  map cannot prevent.
- **One owner for the architecture rules.** Steiger holds all of them — boundaries,
  cross-imports, public-API sidesteps, the shape of the tree. An ESLint version of the same
  rules was tried and dropped: a per-file rule matches the text of an import, and
  `../../home/ui/home-page` reaches a sibling slice without naming a layer. Steiger
  resolves the path to a file instead. It went in while the frontend was three layers,
  because these rules are cheap to satisfy now and a refactor to satisfy after phase 5.
- **The place of a new screen is decided before it is written.** Phases 3–6 add roles, a
  catalogue with filters, a booking form and payment — the kind of growth where a flat
  `components/` folder turns into a pile.
- **`@repo/ui` stays the design system** — the `shared/ui` of the project, generated by the
  shadcn CLI. FSD does not change that: what is domain-free and reusable goes into the
  package, what belongs to one screen stays in the `ui/` segment of its slice.
- The price is the ceremony of a public API per slice. It is paid up front, while the
  frontend is two components — the same reasoning that put the repository step in `auth`
  at the end of phase 2 rather than in the middle of phase 6.

Layers and segments appear when something needs them: `widgets/` does not exist yet, and
`entities/` is still empty and `features/` holds one slice — the listing form, extracted
the day the second screen needed it. The first `model/` segment arrived the same way, with
the session resume of the login page.

## Phase 1 — PostgreSQL + Prisma ✅

Storage moved from an in-memory `Map` to Postgres; per the repository rules only the service changed, while the controller and the contract stayed as they were.

- [x] `docker-compose.yml` in the root: Postgres (Redis later). `DATABASE_URL` in `.env.example`, turbo's `globalEnv` and the README.
- [x] Prisma 7 in `apps/api`: `prisma.config.ts`, a schema with the `Booking` model, committed migrations. The `User`/`Listing` models arrive as migrations in phases 2–3, once there are consumers for them.
- [x] `BookingService` on top of `PrismaService`; the unit spec mocks Prisma, e2e runs against a real database (hence `--experimental-vm-modules` there: the Prisma 7 WASM query compiler is loaded by a dynamic import, which Jest forbids without the flag).
- [x] A seed script with demo data (`pnpm --filter @repo/api db:seed`).

## Phase 2 — Authentication

Implemented by hand (rather than with Auth.js/Clerk) — that is exactly what interviews ask about.

Done on both sides.

- [x] Registration/login: passwords through **argon2**, a JWT pair — access (~15 min) + refresh with **rotation** (the hash of the refresh token is stored in the database; reusing an old token invalidates the whole chain).
- [x] Tokens live in **httpOnly cookies** only, never in localStorage. The browser holds the frontend's copy of the pair rather than the API's — the BFF re-issues both for its own origin — so they are first-party and CORS is not part of the path at all.
- [x] In Nest: `passport-jwt`, a global `JwtAuthGuard` + a `@Public()` decorator for open endpoints.
- [x] On the frontend: `proxy.ts` (what Next.js 16 calls middleware) in front of the protected routes, a server-side fetch that forwards the session cookie, and the `/login`, `/register` and `/profile` screens. Two cookie scopes decide the shape of it: the access cookie is scoped to `/` and therefore reaches the Next.js server, which is what lets a server render read `/auth/me` as the visitor; the refresh cookie is scoped to `/auth` and reaches neither the proxy nor a render, so the only side that can trade an expired session for a live one is the browser.
- [x] The BFF, and the session moved onto the frontend's own origin with it: the browser calls `/api/...`, the proxy re-issues the two cookies for this host, the login/register/logout forms became Server Actions, and the transport answers a 401 with one rotation and one replay — single-flight per tab and across tabs. See "Decisions already made" for why, and `apps/web/CLAUDE.md` for the rules that came out of it.
- [x] The `registerSchema` / `loginSchema` schemas go into `@repo/contracts`: one validation for the form and the request.
- [x] `UserRepository` and `RefreshTokenRepository` in front of Prisma — the repository step of "Layering inside `apps/api`". `AuthService` keeps the rules and no longer imports the generated client, the rotation transaction and the `P2002` translation live in the repository, and the unit spec runs against in-memory fakes: it now asserts what ends up stored (a replayed token revokes the whole family) instead of the arguments of a Prisma call.

## Phase 3 — Roles (RBAC) ✅

Done, the admin's half included: it waited for the catalogue of phase 5, and it grew user
management on the way.

- [x] A `@Roles(Role.OWNER)` decorator + `RolesGuard`, registered globally after `JwtAuthGuard` — it reads the user that one put on the request. Membership of a set rather than a hierarchy: a route that admins may use names `ADMIN`, so what a role can reach is readable where the route is written.
- [x] The `Listing` model (belongs to an OWNER, `price_per_night` in the currency itself, to the cent) and the `listing` module. `Booking` grew up with it: `room_id` and the typed-in `guest_name` became relations to a listing and to a user, because no rule about "their own" can be written against a string.
- [x] **USER** books; **OWNER** creates/edits their own listings and sees the bookings against them; **ADMIN** sees everything, edits any listing and can cancel any booking. `GET /bookings` is narrowed by the role of the caller rather than by a query parameter — the scope is in the `where`, so the query cannot return a row the caller may not see.
- [x] The ownership check stays separate from the role check, and the split is where each of them can be answered: the role is a claim of the access token, so it is a guard; ownership is a property of a row and cannot be known until the row is read, so it lives in the service next to the read (`src/auth/ownership.ts`). A `403` from the guard means "not your kind of endpoint", a `403` from the service means "not your row" — except where naming the row would itself be the leak: nothing lets a stranger list bookings, so an unreadable one answers `404`. Reading and writing are separate rules over the same row as well — an owner reads the bookings against their listing and cannot cancel one.
- [x] On the frontend — conditional rendering by role: `/dashboard` for the owner, with
      the listings CRUD on it (`/dashboard/listings/new` and `/dashboard/listings/[id]`).
      The role decides which screens are offered and which one a visitor is shown, never
      what is allowed: `requireRole` answers `notFound()` for the wrong role, the header
      renders the link for the role that has a use for it, and every request behind both
      is refused on its own merits by `RolesGuard`. It also brought the `features` layer
      into existence — the form is the one thing the new and the edit screen share.
- [x] `DELETE /listings/:id` retires the listing (`deleted_at`) instead of removing the
      row. The bookings are what forced it: the FK is `Restrict`, so a listing with any
      stay against it — a finished one included — could never be let go of, and the `409`
      that came back was a dead end rather than a rule. Retired means out of the
      catalogue, off the dashboard, `404` by id and closed to new bookings, while the
      stays keep their record. What it costs is written down in `apps/api/CLAUDE.md`:
      the foreign key no longer refuses a booking against a retired listing, and phase 4's
      locking transaction is where that check becomes atomic again.
- [x] `/admin` — the same conditional rendering for the role that sees everything, built
      on the catalogue now that it exists: every offered listing, cursor-paged, each one
      edited and retired through the owner's own form (`features/save-listing`,
      `features/delete-listing`, which became a feature with its second screen). The API
      needed nothing new for it — `ownsOrIsAdmin` already let an admin through.
- [x] User management for the admin, which the phase grew: `GET /users` (a keyset page
      with role, status and address filters) and `PATCH /users/:id` (role and block), both
      `@Roles(Role.ADMIN)`, on top of `UserRepository` moved into a `user` module of its own.
      Blocking stamps `blocked_at` and deletes the refresh tokens in one transaction; login
      answers `403` after the password, refresh and `/auth/me` answer `401`, and the access
      token lapses within `JWT_ACCESS_TTL`. No account deletion — bookings cascade and
      listings restrict, so a block is the reversible answer. An admin cannot change or
      block their own account. On the frontend that is `/admin/users`.

## Phase 4 — Concurrent booking (the centrepiece)

The backend is done. Three layers of protection, from UX down to a guarantee in the database:

- [x] **The hold**: a booking is created as `PENDING_PAYMENT` with `expiresAt = now + 15 min` — the slot is taken for the duration of the payment. Expired holds are released three ways, and the third is what makes the first two disposable: a BullMQ job scheduled for the deadline (`booking-expiry`, Redis), the lazy sweep inside the locking transaction, and a repeatable sweep once a minute over every listing. Redis runs without a volume, so a restart drops every scheduled job; without the last one a hold on a listing nobody books again would keep its slot for good.
- [x] **A transaction with a lock**: creating a booking is an interactive transaction with `SELECT ... FOR UPDATE` on the Listing row; competing requests get serialized and the second one receives an honest `409 Conflict`. The same transaction takes over the one check the database stopped making when listings became soft-deletable: `deleted_at` is read under that lock, or a stay can still land on a listing retired a moment earlier (see phase 3).
- [x] **A database constraint as the last line of defence**: the `btree_gist` extension and an **EXCLUDE** constraint (`bookings_no_overlap`) over `daterange(from, to, '[)')` for active bookings — even a bug in the code cannot write overlapping bookings. Applied as a raw-SQL migration.
- [x] The layering step of "Layering inside `apps/api`": a `BookingRepository` in front of
      Prisma — done at the end of phase 3, see the note in "Layering inside `apps/api`".
- [x] `booking/domain/` for the statuses, the transitions and the date range — pure functions, no Nest, no Prisma.
- [x] The proof: `test/booking.concurrency.e2e-spec.ts` — `Promise.all` over 10 parallel requests for the same dates, exactly one `201`, the rest `409`.

The frontend of this phase waits for phase 5, not for Stripe: nothing on this site creates a
booking yet, because the form that would is on the listing page the catalogue has still to
build. What phase 6 adds afterwards is the step that lets a hold become `CONFIRMED` instead
of lapsing.

## Phase 5 — Search and catalogue (the face of the project)

This is also where the frontend of phase 4 lands: the booking a locking transaction has been
guarding since then is created from a form on the listing page, and there is no such page
yet. Until phase 6 that booking has nothing to pay with, so it lives out its fifteen minutes
as `PENDING_PAYMENT` and lapses — an honest state rather than a missing one, and the one
place the hold machinery of phase 4 is visible at all.

The backend of it is done. `GET /listings` is a filtered, cursor-paged catalogue,
`GET /listings/:id/availability` answers the calendar, and the three reading routes are
public — a catalogue behind a login is not a catalogue, and a read that carried a session
could not be cached by URL for every visitor at once. The frontend is built on top of it:
`/listings` is the catalogue, `/listings/:id` the page a stay is booked from, `/bookings`
the list of stays every role reads its own scope of. The one box left is PPR, and the note
on it says why it is a change to the transport rather than a flag.

- [x] A list of listings with filters (dates, price, capacity); filters live in the **URL searchParams** (shareable links), Server Components, cursor pagination.
      The filters and the page are `listingQuerySchema` in the contract, so the same shape
      that validates the query string in Nest parses `searchParams` in
      `_pages/catalogue/lib/catalogue-search.ts` — a URL is untrusted text, and what the
      schema refuses is shown under the box it belongs to instead of being sent. The form
      is a plain `method="get"`, which is what makes a search a link somebody can send and
      what makes it work with no JavaScript at all; the price of that is a URL spelling
      out the boxes nobody filled in, which the contract reads as the absences they are.
      `nextCursor` is a keyset cursor over `created_at, id` rather than an offset — a
      listing published while somebody is paging shifts every offset after it — so the
      pages go forwards only, and a cursor this API did not issue answers `400`, which the
      page shows as a stale link rather than as the first page of a question nobody asked.
- [x] The indexes that read needs, and the first ones this project has had to think about.
      `listings` carried `owner_id` alone, which serves the dashboard and leaves the
      catalogue a sequential scan. What went in is one index over the pair the cursor
      orders by (`created_at DESC, id DESC`), partial on `deleted_at IS NULL` — the
      condition every read of that table already carries, so the retired rows stay out of
      the index that serves the catalogue. Prisma can spell neither the `WHERE` nor the
      direction, so it is a raw-SQL migration like the EXCLUDE constraint of phase 4. The
      filters deliberately got none: they narrow a scan the ordering already drives, and
      which of them earns an index is a question for a query plan over real data.
- [x] The first cached reads in the application, and with them the rest of the
      revalidation table in `apps/web/CLAUDE.md`: the catalogue, one listing and
      its availability are the three public reads, they carry `next: { tags }`, and the
      names are written once in `shared/config/cache-tags.ts` because a tag is a string
      two halves have to spell the same way. The three are separate because the writes
      are: editing a listing changes the row and the catalogue but not who has booked it,
      and taking a booking changes what is free without touching the row. A mutation
      answers with `revalidateTag(tag, "max")` for everybody else and `updateTag` for the
      author who is about to be shown their own write. The two reads a hold changes carry
      a minute's lifetime beside the tag as well: a hold lapses on a timer rather than on
      a mutation, and a minute is the interval of the sweep the API releases it on.
- [ ] `cacheComponents: true` and PPR — the catalogue is finally the page whose shell is
      worth prerendering, and the flag turned out not to be a flag. Under
      `cacheComponents` the `cache` and `next` options of `fetch` stop being how a read is
      cached: `"use cache"` with `cacheLife`/`cacheTag` replaces them, which is a rewrite
      of the `ReadOptions` argument every read method of `shared/api` takes and of the
      rule that the call site decides. It is its own change, on top of the reads this
      phase has just written down, rather than a line in `next.config.js` — and the header
      still reads the session in the root layout, so it also needs the `<Suspense>`
      boundary that turns the shell into the prerendered part.
- [x] `notFound()` for a 404 from `ApiResponseError` — `orNotFound` in `shared/lib`, now
      that two screens read a single row by an id out of the URL. `requireId` beside it is
      the other half: a segment that cannot be a uuid is refused by `ParseUUIDPipe` with a
      `400`, which is a statement about the request rather than about the row and must not
      be translated wholesale — so the page settles that one for itself.
- [x] The listing page: an availability calendar from the API, a booking form with a price calculation.
      `GET /listings/:id/availability` returns the ranges that still hold their slot for a
      window, whole rather than clipped to it, so the calendar drawing its last day knows
      the nights continue. It is a server component and it decides nothing: the booking is
      still refused, or not, inside the locking transaction, and a `409` from it is shown
      under the form like any other refusal. The form is the one thing on this site that
      creates a booking, which is where the frontend of phase 4 finally lands. What it
      does not send is the price: the total beside the dates is what the guest is told,
      and the API reads the nightly rate off the listing — which is why
      `createBookingSchema` has no amount on it at all.
- [x] "My bookings" with statuses and cancellation — of a hold, which is all a booking can
      be until phase 6; a refund is that phase's. It is also where the row a retired
      listing leaves behind finally has to become readable. Phase 3 keeps that row so a
      stay can go on naming where it was, but nothing on the API surface resolves it:
      `GET /listings/:id` answered `404` to everybody, the guest holding the booking
      included, and a booking carried only `listingId`. Of the two ways out — the booking
      response carrying the listing it names, or that read resolving a retired row for
      whoever has a stay against it — the first is what went in: every booking now carries
      the title and the nightly price of its listing, read whether or not it is still
      offered. The second stopped being available in the same change, and that is what
      settled it: `GET /listings/:id` is public and cached by URL, so it has no visitor to
      make an exception for. On the frontend it is one page with three scopes, because
      `GET /bookings` is: a guest reads the stays they took, an owner the stays taken
      against their listings, an admin all of them. Cancelling follows the same split the
      API makes between reading a row and writing it — the owner who may see a stay is not
      offered the button, and the button being there is an offer rather than a permission.
- [x] The availability check by dates — the same SQL range-overlap predicate as in phase 4,
      and literally the same one: the catalogue's date filter and the calendar both import
      `holdsTheSlot` and `overlapping` from `BookingRepository`, so what "taken" means
      cannot drift between the search and the transaction that refuses the booking. A
      lapsed hold holds nothing, whether or not the job meant to release it has run.

## Phase 6 — Stripe

The full payment cycle through **PaymentIntent**, on top of the screens phase 5 built — the
payment step is inserted into a booking flow that already works end to end, and what it adds
is the transition a hold could not make on its own:

- [ ] `POST /bookings` → a hold + a PaymentIntent (the `amount` is computed by the server from the listing price, never taken from the client), the frontend receives `client_secret` → Stripe Elements.
- [ ] The **webhook** `payment_intent.succeeded` → the booking becomes `CONFIRMED`. Signature verification (`STRIPE_WEBHOOK_SECRET`, raw body), **idempotent** handling, and the webhook — not the user's redirect — as the source of truth.
- [ ] Cancelling a confirmed booking → a **refund** by the rules (a full refund 48 h before check-in, for example).
- [ ] An expired hold → the PaymentIntent is cancelled.
- [ ] The `PaymentGateway` port with a Stripe adapter behind it, and the use cases of
      `booking/application/` — the webhook and the BullMQ job become entry points of their
      own, alongside HTTP.
- [ ] Locally — `stripe listen` (as a service in docker-compose), test cards documented in the README.
- [ ] **TanStack Query** on the frontend, and this is the phase that earns it: the source
      of truth for a payment is the webhook, so the screen has to poll the booking until
      the status changes (`refetchInterval`) instead of trusting the redirect. Cancelling a
      booking gets an optimistic update with a rollback in the same change. It is
      deliberately not installed before then — until there is client state worth caching it
      would only replace three `useState` in forms that are moving to Server Actions
      anyway, which is a rewrite paid for twice.

## Phase 7 — Production polish

- [ ] Tests: unit tests for the services, e2e over the whole booking and payment cycle (Stripe mocked), the concurrency test from phase 4.
- [ ] CI: GitHub Actions — `lint`, `check-types`, `test`, `build` with the turbo cache; a badge in the README.
- [x] Rate limiting (`@nestjs/throttler`) on the auth endpoints — pulled forward into phase 2: argon2 turns an unlimited `/auth/login` into a memory amplifier, so it could not wait.
- [ ] Helmet.
- [ ] Bring Swagger up to a complete description with examples and auth.
- [ ] Observability: structured logs (pino), a request-logging interceptor, `/health` (`@nestjs/terminus`).
- [ ] **JSON-LD across the whole site** — the structured data a catalogue is actually read
      by, and the one SEO question this project has so far answered with nothing. Semantic
      markup is not that answer: wrapping the rows in a `<ul role="list">` bought a screen
      reader a count and an edge (`apps/web/CLAUDE.md`) and buys a crawler nothing,
      because nothing ranks on list markup. What a search engine reads a stay out of is
      `application/ld+json`, and it is the difference between a blue link and a result
      carrying a price and a capacity.

      Four documents, each on the page whose data it describes — a graph assembled in one
      place would have to be kept in step with screens it cannot see:

      - `Organization` and `WebSite` in the shell (`_app/layout`), the two the whole site
        shares, emitted once in the root layout rather than per page.
      - `ItemList` on `/listings`, its `itemListElement` the rows the page has already
        read. It describes the page that was asked for, so a filtered search and a cursor
        page each describe themselves rather than the catalogue as a whole.
      - `Accommodation` (`VacationRental`) with an `Offer` on `/listings/:id` — the title,
        the description, `occupancy` off the capacity, and the nightly price as a
        `UnitPriceSpecification` in the currency the contract stores. Google's
        vacation-rental result is a partner programme; the `Offer` and its price is the
        half that earns a rich result without one.
      - `BreadcrumbList` on both, since the trail is `/` → `/listings` → the row and each
        page already knows its own.

      Three things it has to get right, and all three are why this is a phase item rather
      than a snippet:

      - **The document is built from the contract type the page already renders** — off the
        parsed `Listing`, not from a second read and not from fields assembled by hand. A
        document that disagrees with the page it sits on is what a crawler penalises, and
        that drift is exactly what a shared schema exists to prevent.
      - **It is untrusted text inside a `<script>`.** A title and a description are written
        by an owner, so a `</script>` in either one closes the block early and puts the
        rest of the row into the document as markup. `JSON.stringify` does not escape it:
        turning `<` into `\u003c` is the whole defence, and it belongs in one helper in
        `shared/lib` with a spec beside it — a parser whose input somebody else writes is
        the first of the four kinds of spec the frontend rules already name.
      - **Indexing goes in the same change**, because half of a catalogue's SEO is what not
        to index. A cursor is opaque and unrepeatable, so a `?cursor=…` page gets
        `robots: { index: false, follow: true }` out of `generateMetadata` and a canonical
        pointing at the same search without it, while a filtered search canonicalises to
        itself. The pages also still have no `metadata` of their own — a title, a
        description and `openGraph`, and on `/listings/:id` all three off the row.

      What stays out: `AggregateRating` and `Review` until the optional reviews below
      exist, and `availability` on the offer — that would be a promise about dates the
      calendar answers per window and a document cannot state for a stay as a whole.

- [ ] Optional: reviews with ratings, email notifications through BullMQ.

## Phase 8 — Deployment and presentation

- [ ] Web on Vercel; API + Postgres + Redis on Railway or Fly.io. `API_ORIGIN` is a runtime variable of the frontend server, so a changed API address is a redeploy without a rebuild; `TRUST_PROXY` on the API has to reach past the extra `X-Forwarded-For` entry the frontend server's own request produces.
- [ ] The README as a pitch: screenshots, an architecture diagram, an "interesting decisions" section (concurrency, webhooks, refresh-token rotation), a three-command start, Stripe test cards, demo logins for all three roles.
- [ ] The demo scenario: two browser windows book the same slot at once — one goes to payment, the other receives a polite conflict.

## Phase 9 — Localization

The whole tree is English today, the interface included, and that is a rule rather than an
accident (`.claude/rules/workflow.md`). This phase is the one change allowed to touch it,
and the rule already says how: Russian comes back as a translation catalogue, never as a
string typed into a component. It comes last because it touches every screen — doing it
before the screens were finished would be paying for each of them twice — and because two
of its pieces were written in advance, each with a note saying so.

- [ ] **`next-intl` and a `[locale]` segment.** It is the toolkit built for the App Router
      rather than around it: `getTranslations` in a Server Component, `getLocale` instead
      of reading the segment out of `params`, and ICU messages so a plural is a rule of the
      catalogue rather than of the code. The locale goes in the path — `/en/listings`,
      `/ru/listings` — and not in a cookie, and the Data Cache is what settles that: it is
      keyed by URL and shared between visitors, so a catalogue whose language lived in a
      cookie would serve one visitor's language to the next one out of the same entry. In
      the path, the two languages are two keys and the sharing stays correct.
- [ ] **`app/` grows a level and `src/` does not.** Every file under `app/` is a one-line
      re-export, so moving the tree under `app/[locale]/` is mechanical and the slices it
      re-exports never learn about it. `app/api/[...path]` stays outside that segment — the
      BFF is transport, it has no language, and the middleware's matcher has to say so.
      `ROUTES` in `shared/config` stays locale-free too: the prefix is added by the
      navigation helpers `createNavigation` generates, which is one place rather than
      every `href` on the site.
- [ ] **One `proxy.ts`, two jobs.** Next.js allows a single middleware, and this one already
      is the cookie gate in front of the protected routes; `createMiddleware` from
      `next-intl` is a second function that wants the same slot. They compose — the locale
      is resolved first, the gate then reads a path it can recognise — and the matcher
      literal in `proxy.ts` has to learn the prefix, since `/profile` and `/ru/profile` are
      the same protected route. The literal stays a literal: Next.js parses it out of that
      file before any import is evaluated, which is why it could never be `ROUTES` and
      cannot become a generated list now.
- [ ] **The contract answers with a code, not a sentence — and this is the real work of the
      phase.** Today a refusal is English prose written in a zod schema or a Nest
      exception, and it reaches the screen as it is: `form-errors.ts` puts it under the
      field it names. A Russian form showing an English refusal is the whole problem, and
      translating on the frontend by matching the text would be a parser over somebody
      else's prose. So `apiErrorSchema` grows a stable `code` per issue, the schemas in
      `@repo/contracts` carry one on every rule, and the catalogue maps a code to a
      message with the parameters the rule already knows (a minimum, a ceiling, a date).
      The English prose stays as the fallback for a code no catalogue has yet, and as what
      `/docs` and the API's own logs keep saying. It is a contract change, so it lands in
      one place for both sides — which is the argument the shared package has been making
      since phase 1.
- [ ] **A Server Action has to be handed its locale.** `next/root-params` does not reach
      one, so `getTranslations({locale, namespace})` needs the value passed in — and
      mutations here are Server Actions by default. That makes it a rule for the whole
      `api/` segment of every page slice rather than a detail of one form: the locale
      travels as a hidden field of the form, beside the `sort` the catalogue's dialog
      already carries for the same kind of reason.
- [ ] **Two formatters were written for this and one must not be touched.** `countOf` in
      `shared/lib/plural.ts` says in its own comment that `Intl.PluralRules` and a
      catalogue replace its body and nothing else; `formatMoney` names `en-GB` explicitly
      so the server and the browser agree on the separators, and localizing it means
      choosing the locale rather than dropping the argument — a `undefined` locale is the
      runtime's, and the server's runtime is not the visitor's. `shared/lib/dates.ts` is
      the one that stays: a calendar day is a `YYYY-MM-DD` string read as midnight UTC,
      because that is the clock the contract compares a check-in against. Only its display
      is localized; parsing one in the visitor's zone moves a stay by a day.
- [ ] **The SEO of two languages**, and it is the other half of the JSON-LD item in phase 7.
      `<html lang>` comes from the resolved locale instead of the literal `en` it carries
      now, `generateMetadata` emits `alternates.languages` so each page names its
      counterpart, and every JSON-LD document gains `inLanguage`. A locale is a path
      segment, so a canonical is per language and the `?cursor=…` rule from phase 7 applies
      unchanged in both.
- [ ] **What stays English.** Everything that is not the interface: code, comments, tests
      and their fixtures, commit messages aside, the seed's demo data, the API's logs and
      Swagger. The catalogue files are the only place in the tree where Cyrillic lands, and
      `.claude/rules/workflow.md` is updated in this change to say so instead of saying
      "when i18n appears".

What stays out: translating what an owner wrote. A listing's title and description are
their author's text in their author's language, and a `language` column with per-locale
copy behind it is a product decision rather than an engineering one. So is currency —
money is stored and answered in one currency, and localizing how a number is written is
not converting what it is worth.

## Decisions already made

- **Prisma** (v7: `prisma.config.ts`, the `prisma-client` generator, the `@prisma/adapter-pg` driver adapter) — the most recognizable ORM; interactive transactions and raw migrations cover phase 4.
- **PaymentIntent + Elements** for Stripe — a payment form of our own instead of a Checkout redirect.
- **httpOnly cookies + refresh-token rotation** for auth — ready answers to the XSS/CSRF questions.
- **A BFF in `apps/web`** — the browser reaches the API only through `/api/...` on the
  frontend's own origin. The frontend deploys to Vercel and the API to Railway, which are
  different sites however the domains are arranged, and a preview deployment on a
  throwaway hostname is a different site again; a session that has to cross that boundary
  needs `SameSite=None`, which Safari's tracking prevention drops. Behind the proxy the
  cookie is first-party everywhere. It also removed CORS from the picture, made
  `AUTH_COOKIE_DOMAIN` irrelevant to the frontend and turned the API address from a
  build-time constant in the bundle into a runtime variable of the server. The price is a
  hop on every browser request and one more `X-Forwarded-For` entry for `TRUST_PROXY` to
  reach past. Between the
  two ways of writing it, the proxy re-issues the session itself (`cookies().set()`)
  rather than rewriting the `Domain`, `Path` and `SameSite` of the API's own `Set-Cookie`
  on the way past — rewriting attributes in a header is the part that fails silently.
- **The refresh stays in the browser**, even though the BFF could hold it. The refresh
  cookie is scoped to `/api/auth`, so a page render never receives one, and rotation is
  performed by the transport when a request comes back 401 — single-flight per tab through
  a promise and across tabs through `navigator.locks`. Moving it to the server would make
  every guarded navigation a possible rotation and would put the credential that mints
  sessions into requests that have no use for it.
- **A modular monolith by default, ports and adapters in `booking` only** — the module with
  real domain rules and three entry points. The reasoning and the boundaries are in
  "Layering inside `apps/api`".
- **Mutations are Server Actions by default.** Cookies are written on the server, the
  contract schema refuses an obvious mistake before a request is spent, the form works
  before React has hydrated, and `refresh()` / `updateTag` are reachable only from there.
  The client path stays for what a round trip cannot express — an optimistic update with a
  rollback, a poll for a webhook — and phase 6 is what brings the first of those.
- The order of the phases follows the dependencies: database → auth → roles → concurrency → catalogue → Stripe → polish → deployment. The catalogue comes before Stripe because the dependency runs one way only: Stripe Elements needs a booking to attach to, and a booking is created from the form on the listing page, which is the catalogue's. Nothing in the catalogue needs a payment — it is server-rendered from `searchParams`, and TanStack Query arrives with the polling of the webhook.

## Decisions deliberately not taken

- **A grace window on refresh-token rotation** — `AuthService.refresh` answering a
  just-burned token with the pair it already issued, for a few seconds, the way Auth0's
  leeway does. It fixes exactly one thing the client cannot: a rotation whose answer never
  arrived leaves the browser holding a token the database has already spent, and the next
  attempt looks like a replay and revokes the family.

  It is not implemented, and the reason is the storage. Replaying an answer means keeping
  the issued pair readable for the length of the window, which contradicts the property the
  design is built on — only the SHA-256 of a refresh token is stored, so a dump of the
  database yields no usable session. The two cases that made the window attractive are
  already covered from other directions: two parallel refreshes are the conditional
  `updateMany` in `RefreshTokenRepository.rotate`, which fails one request and spares the
  family, and several tabs refreshing at once are the Web Locks mutex in the browser. What
  remains is a lost response — rare, and its cost is one login.

- **`widgets/` on the frontend** — see "Layering inside `apps/web`".

- **OpenAPI codegen for the frontend client** (orval, hey-api, ts-rest). The contract is
  already shared as zod schemas in `@repo/contracts`, which gives both sides the same
  types and the same validation from one source; a generator would add a build step to
  produce a second description of the same thing.
