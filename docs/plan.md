# Project roadmap

The goal is to bring this pet project to a state that demonstrates production-grade engineering decisions to an employer: a contract shared by the frontend and the backend, honest authentication, a payment cycle with webhooks and correct handling of concurrent access at the database level. Every phase ends with a working, demonstrable feature and its own PR into `main`.

## Target architecture

```
apps/web  (Next.js 16)  ──HTTP──▶  apps/api (NestJS 11)  ──▶  PostgreSQL (Prisma)
     │                                  │                         │
     │  @repo/contracts (zod)           ├──▶ Stripe (PaymentIntent + webhook)
     └────── the shared contract ───────┘
                                        └──▶ Redis + BullMQ (hold expiry, payment events, payouts)
```

The domain model (grown phase by phase):

- **User** — `id, email, passwordHash, role (USER | ADMIN)` — phases 2–3; hosting is owning a listing, not a role (see the end of phase 3)
- **Listing** (a place to stay) — belongs to one user, its host, has a nightly price — phase 3
- **Booking** — `status: PENDING_PAYMENT | CONFIRMED | CANCELLED | EXPIRED`, `expiresAt`, `paymentIntentId`, a date range — phases 1 → 4 → 5
- **Review** — phase 8

## Layering inside `apps/api`

The default of the repository stays a modular monolith, now with the
`module → controller → service → repository → Prisma` layering described in
`apps/api/CLAUDE.md`. One departure from it is planned, and only one.

**Everywhere: a repository between the service and Prisma — done.** No service imports the
generated client or the row types any more (the mappers live in the repository), so a unit
test fakes a repository instead of a query builder. It is a rule now rather than a
judgement call: `auth`, `booking` and `listing` all have one, and so does the next module.
Cheap, and it is the step the market means when it asks for "clean architecture".

**In `booking` only: ports and adapters — done in phase 6.** With the payment cycle in,
that module is the one that earned the full
`domain / application / infrastructure / presentation` split:

```
booking/
  domain/            # status transitions, date range, the stay's quote — no Nest, no Prisma
  application/
    ports/           # PaymentGateway — an abstract class, which is also its DI token
    booking.service.ts  # create / pay / confirm / cancel / expire holds
  infrastructure/    # BookingRepository, StripePaymentGateway, the webhook inbox, BullMQ jobs
  presentation/      # controller, Stripe webhook controller, dto
```

Two places where it came out simpler than drawn here, both on purpose. The repository is
not a port: `apps/api/CLAUDE.md` already settled that a second implementation of Postgres
is never coming, so `BookingRepository` stays a class injected by its own type and only
Stripe sits behind an interface. And the use cases are one application service rather than
a file each: the three entry points share the notices, the payment withdrawals and the
waitlist hand-over between them, and splitting `BookingService` would have meant those
helpers living in a fifth file every use case imports — the split the layer exists for is
between the entry points and the rules, and that one is there. Sending the refund a
cancellation owes was later moved out into `BookingRefundService`: it shares none of those
helpers — the cancellation decides the refund and queues it, the job, its sweep and the
admin's stuck list only send it — so the cut costs no shared file. The refund rule went to
`@repo/contracts` (`refundQuote`) rather than `domain/`, because the booking page states
it to the guest before the API applies it — the reason `nightlyPrice` lives there.

What justifies it there and nowhere else:

- **Rules that are pure functions**: which status transition is legal, what a cancellation
  refunds 48 h before check-in, what a stay costs. They belong in `domain/`, where they are
  tested without a database and without the network.
- **Three entry points into one piece of logic**: HTTP creates a booking, the Stripe webhook
  confirms it, a BullMQ job expires the hold. That is what makes `application/` a layer
  rather than a formality — with a single entry point it would be one.
- **Two external worlds**: Postgres and Stripe. `PaymentGateway` as a port is what makes the
  "e2e over the whole cycle, Stripe mocked" of phase 8 an architectural property instead of a
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
- **`review` (phase 8)** — CRUD: the repository and nothing more.

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
`booking/domain/` with the statuses; the port and the application layer followed when
Stripe arrived in phase 6. Introducing the layers before the rules exist would be a refactor of a CRUD,
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
- [x] One account instead of one persona: `OWNER` retired, `Role { USER, ADMIN }`. Who
      hosts is `listing.ownerId` and who is a guest `booking.guestId`, so any user publishes
      listings and books other people's — never their own (`403`). The lists of stays and
      the lookups take `side: GUEST | HOST`, drawn as the "Trips" and "Hosting" tabs of
      `/bookings`. The migration turns every `OWNER` row into a `USER` before it recasts the
      enum. The plan it followed is `docs/single-account-migration.md`; the items above are
      the history of the three-role model.

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
the list of stays every role reads its own scope of. PPR was the one box left; it was tried
after the deploy and not kept — see "Decisions deliberately not taken".

- [x] A list of listings with filters (dates, price, capacity); filters live in the **URL searchParams** (shareable links), Server Components, cursor pagination.
      The filters and the page are `listingQuerySchema` in the contract, so the same shape
      that validates the query string in Nest parses `searchParams` in
      `_pages/listings/overview/lib/catalogue-search.ts` — a URL is untrusted text, and what the
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

## Phase 6 — Stripe ✅

The full payment cycle through **PaymentIntent**, on top of the screens phase 5 built — the
payment step is inserted into a booking flow that already works end to end, and what it adds
is the transition a hold could not make on its own. The details are "Payments" in
`apps/api/CLAUDE.md` and the stay's page in `apps/web/CLAUDE.md`.

- [x] A hold carries its price: `amount` is quoted inside the locking transaction by
      `nightlyPrice`, from the prices read under the same lock, and never taken from the
      client. The PaymentIntent behind it is opened by `POST /bookings/:id/payment`, which
      the payment form calls from the browser, rather than by `POST /bookings`, under an
      idempotency key named after the booking: the `client_secret` has to reach the page
      that pays, a redirect cannot carry it, and one path that opens or replays the intent
      is simpler than two. `createBookingAction` redirects to that page, `/bookings/:id`,
      where Stripe Elements confirms the payment.
- [x] The **webhook** `payment_intent.succeeded` → the booking becomes `CONFIRMED`.
      Signature verification over the raw body (`STRIPE_PAYMENT_WEBHOOK_SECRET`), an
      **inbox** — the event recorded in `payment_events` and answered at once, handled by a
      BullMQ worker with retries and a sweep, every step idempotent by itself — and the
      webhook, not the user's redirect, as the source of truth. Both sides are told
      (`BOOKING_CONFIRMED`).
- [x] Cancelling a confirmed booking → a **refund** by the rules: in full up to 48 h before
      check-in and nothing after for the guest, in full for an admin, and no cancellation by
      either once the check-in day has come (`refundOnCancel` and `isCancellableOn` in
      `@repo/contracts`, which the page states before the button). The cancellation writes
      what it owes on the row and a job sends the refund, so a Stripe failure delays a
      refund rather than a cancellation.
- [x] An expired hold → the PaymentIntent is cancelled, on all three expiry paths and on a
      cancelled hold. A payment that completes anyway reaches the webhook for nights that
      are no longer the guest's and is refunded in full (`PAYMENT_REFUNDED`).
- [x] The `PaymentGateway` port with a Stripe adapter behind it, and `booking/application/`
      — the webhook and the BullMQ job are entry points of their own, alongside HTTP.
- [x] Locally — `stripe listen` as a service in docker-compose (the `stripe` profile), test
      cards documented in the README.
- [x] **TanStack Query** on the frontend, on the stay's own page only: the source of truth
      for a payment is the webhook, so the page polls the booking (`refetchInterval`) until
      the status changes instead of trusting the redirect, and cancelling there updates the
      same cache once the API has answered. Everything else is still server-rendered.
- [x] **Host payouts through Stripe Connect** — a marketplace with separate charges and
      transfers: the guest pays the platform, and 24 h after check-in the host's share
      (`hostShare`: what is left after refunds, less the platform's 15%) is transferred to
      their Accounts v2 recipient, funded by the guest's own charge. Embedded onboarding on
      `/dashboard/payouts`; a host who has not finished it is booked as usual and paid once
      Stripe reports the account ready (a thin account event, or the screen asking again).
      A job per stay plus an hourly sweep, like hold expiry.
- [x] **`charge.refunded` and disputes reach the stay.** A full refund from the dashboard
      cancels a confirmed stay, a partial one tells the guest; a refund after the payout is
      taken back from the host by a reversal. A dispute holds the payout; a lost one
      reverses a payout already sent. Stripe.js runs under a `Content-Security-Policy` with a
      script nonce per request.

## Phase 7 — Cancellation policies and refunds

Today one rule covers the whole site: a guest's cancellation refunds in full until 48 hours
before midnight UTC of check-in and nothing after, an admin's refunds in full, nobody
cancels once the stay has begun, and a host cannot cancel at all. The machinery around that
rule — the debt written with `CANCELLED`, the refund job, its sweep, the set-aside rows,
`settle` taking back a payout — is already shaped for any amount, so this phase changes the
rules and adds the paths that are missing, not the plumbing. The model is the industry's:
a policy chosen per listing, frozen onto the booking, tiers with a partial refund, a grace
period, a non-refundable rate for a discount, host cancellations with a fee, an early
check-out refunding unused nights. Six steps, each its own branch and pull request, in this
order — each later step reads the function the first one introduces.

### 7.1 — A policy per listing, frozen onto the booking, and the grace period ✅

| Policy           | 100%       | 50%       | Unused nights (7.4) |
| ---------------- | ---------- | --------- | ------------------- |
| `FLEXIBLE`       | ≥ 48 hours | —         | 100%                |
| `MODERATE`       | ≥ 5 days   | —         | 50%                 |
| `LIMITED`        | ≥ 14 days  | 7–14 days | 0                   |
| `FIRM`           | ≥ 30 days  | 7–30 days | 0                   |
| `NON_REFUNDABLE` | —          | —         | 0 (7.5)             |

`FLEXIBLE` is today's rule, so the migration gives it to every existing listing and booking
and no stay already taken changes its terms. The grace period: a booking cancelled within 24
hours of being created, with check-in still more than 7 days away, refunds in full under any
policy except `NON_REFUNDABLE` — a discount that is free to undo for a day is not a trade.

- [x] `@repo/contracts`: `cancellationPolicySchema`, and the terms as data —
      `CANCELLATION_TERMS: Record<Policy, { tiers: RefundTier[]; unusedNightsBps: number;
grace: boolean }>`, a tier being `{ hoursBefore, shareBps }`. `checkInInstant(booking)`
      becomes the one anchor every window is measured from (midnight UTC of `from` for now,
      so 7.6 changes one function). `refundQuote(booking, now, canceller)` →
      `{ shareBps, cents, next: { until, shareBps } | null }` replaces `refundsInFull` and
      `refundOnCancel`, and both sides read it: the API owes by it, the booking page words it.
      The guest is owed `max(0, shareOf(amount, bps) − refunded)`, rounded half up in their
      favour; an admin (and, from 7.2, a host) `notRefunded`, as today.
- [x] `cancellationPolicy` on `listingSchema` and `createListingSchema` (optional, `FLEXIBLE`
      by default) and on `bookingSchema`.
- [x] Prisma: `enum CancellationPolicy`, `listings.cancellation_policy` (default `FLEXIBLE`),
      `bookings.cancellation_policy` (backfilled, then `NOT NULL` with no default, so `create`
      has to write it). `BookingRepository.create` reads the policy under the same
      `FOR UPDATE` as the prices and copies it, the way it copies `amount_cents`: a later
      change of the listing's policy does not restate a stay.
- [x] `BookingService.refundOwedOnCancel` owes by `refundQuote`; the debt, the job and the
      sweep stay as they are. `BOOKING_CANCELLED` carries `refundCents` and `currency`.
- [x] Web: the policy's name, summary and tiers as sentences in `entities/booking` (the
      listing form, the listing page, the stay's page and `features/cancel-booking` read
      them); a select in `features/save-listing`; a "Cancellation" block beside the booking
      form with the dates for the nights chosen; the whole schedule on the stay's page;
      `cancellation-refund.ts` worded from `refundQuote` ("Cancelling now refunds 50% (X);
      before D it would have been 100%").
- [x] The seed spreads listings across the policies.
- [x] Specs: `refund.spec.ts` (every tier edge, the grace period at 23:59 / 24:01 and 6 / 7
      days, rounding, a share after a dashboard refund), `booking.service.spec.ts`,
      `cancellation-refund.spec.ts`; e2e — a cancellation in a 50% window owes exactly half,
      the policy round-trips through `POST`/`PATCH`/`GET /listings`.

### 7.2 — Host cancellations, and the fee they cost ✅

A host who cancels a stay always refunds the guest in full, and pays for it: the platform
loses Stripe's processing fee on every full refund and the guest loses their plans.

| Cancelled by the host | Fee, of `amount_cents` |
| --------------------- | ---------------------- |
| ≥ 30 days before      | 10%                    |
| 48 hours – 30 days    | 25%                    |
| < 48 hours            | 50%                    |

- [x] `@repo/contracts`: `Canceller` gains `HOST`; `hostCancellationFee(booking, now)` by the
      table, through `checkInInstant`, and nothing for a hold — declining an unpaid request
      is free. Both sides read it: the API charges by it, the host's dialog states it before
      the button. `cancelledBy` on `bookingSchema`; a `reason` the host has to give
      (`cancelBookingSchema`), optional for the guest.
- [x] Prisma: `bookings.cancelled_by`, `cancelled_at`, `cancellation_reason`; a `host_fees`
      ledger — one row per cancelled stay (`booking_id` unique), `host_id`, `amount_cents`,
      `withheld_cents`, `waived_at` with `waive_reason`, the usual `CHECK`s
      (`withheld ≤ amount`, waived with a reason or neither).
- [x] `BookingService.mayCancel` admits the listing's owner, before check-in, for a hold and
      a confirmed stay; the cancellation writes the fee row in its own transaction. The
      threshold counts the fees, so a declined hold is not a cancellation against the host.
      "Reading and writing are separate rules" in `apps/api/CLAUDE.md` changes with it.
- [x] **The fee is withheld from the host's next payouts**, since nothing of the cancelled
      stay was ever paid to them. `PayoutService.payOut` transfers `owedToHost(stay)` less
      what the host still owes, oldest fee first, and records it as
      `bookings.fee_withheld_cents` and in `host_fees.withheld_cents` when it reserves the
      payout (`payout_reserved_cents`) — a short transaction under a per-host advisory lock,
      so two stays paid out at once cannot withhold the same debt. The transfer goes out
      after it under the settlement's lease rather than inside a transaction, so no pool
      connection waits on Stripe, and a retry sends the reserved amount; `settle` records a
      transfer a dead run never wrote, or releases a reservation a refund left uncovered. `settle` counts `paid_out + fee_withheld` as what the
      host holds: when a later refund leaves the stay owing less, it reverses the transfer
      first and hands any shortfall back to the fee as debt rather than inventing a negative
      transfer. Checked before building it: Stripe's account debits need the host's legally
      binding consent, the same region and money on the connected balance — which a recipient
      account has usually paid out already — so the withholding stays. A payout the fees take
      whole sends no transfer, so "paid out" became `paid_out_at` rather than `transfer_id`.
- [x] A fee nobody can withhold — a host who never earns again — stays on the admin's
      screen; the platform does not charge a host's card.
- [x] `POST /host-fees/:id/waive` (`@Roles(ADMIN)`, a reason): the extenuating circumstance
      a policy cannot foresee. What was already withheld stays withheld.
- [x] Visibility: the host's payouts page lists the fees still owed; the admin's account page
      shows the host's cancellations in the last 12 months and the fees; a third
      cancellation in 12 months tells every admin. Notices: `BOOKING_CANCELLED` with
      `cancelledBy: HOST` and the reason to the guest, `HOST_CANCELLATION_FEE` to the host,
      `HOST_CANCELLATIONS_THRESHOLD` to the admins.
- [x] Web: "Cancel" on the Hosting tab and on the stay's page for its host, with the fee and
      the reason in the dialog; `may-cancel.ts` and its spec.
- [x] Specs: the fee's tiers; e2e — the guest is refunded in full under any policy, the fee is
      withheld from the next payout, two payouts at once withhold it once, a refund after the
      withholding returns the shortfall to the debt; the old "a host cannot cancel" case is
      rewritten.

### 7.3 — A partial refund by an admin, without a cancellation ✅

- [x] `adminRefundSchema { amountCents, reason, requestId }`, at most `notRefunded − refundOwed`,
      less the last cent of a stay that can still be cancelled — a full refund before check-in
      would cancel it.
- [x] `POST /bookings/:id/refunds` (`@Roles(ADMIN)`) refunds at once under
      `booking-<id>-adjustment-<requestId>` — the dialog mints the id, so a second press is
      the same refund — and records it in `booking_adjustments` (who, how much, why, the
      provider's refund id). An open dispute is a `409`.
- [x] Nothing new downstream: `charge.refunded` raises `refunded_amount_cents`, `StayEvents`
      reaches `settle`, and a payout already sent is reversed by the difference.
- [x] Web: "Refund part" on the stay's page for an admin (`centsFromInput`, a reason), and the
      adjustments listed under the stay.
- [x] Specs: e2e — more than is left is refused, a repeated `requestId` refunds once, a
      refund after the payout reverses the host's share.

### 7.4 — Ending a stay early, refunding the unused nights ✅

- [x] `@repo/contracts`: `mayEndEarly(booking, today)` — confirmed, begun, at least one night
      left — and `unusedNightsRefund(booking, nights, today)`: the `booking_nights` from
      tomorrow's on, times the policy's `unusedNightsBps`. Tonight is used. An earlier partial
      refund names no nights, so it counts as spread over all of them by price: the unused
      nights keep `notRefunded / Σ nights` of their worth — which also prices them at the
      discount of a non-refundable rate (7.5).
- [x] The stay stays `CONFIRMED`; `to` moves to the new check-out and `ended_early_at` is
      stamped, so the `EXCLUDE` constraint and the waitlist see the nights free and the
      review opens at once. `booking_nights` keep what was bought. A stay with no nights
      recorded (before `store_money_in_cents`) cannot end early.
- [x] `POST /bookings/:id/end-early` (the guest, an admin) under `whileCancelling`: the debt
      goes into `refund_owed_cents` and out through the same job. The key
      `booking-<id>-cancellation` is shared safely — a cancellation happens only before
      check-in and an early end only after. Then `announceFreed`.
- [x] The host's side needs nothing: `owedToHost` already counts a refund owed, and `settle`
      reverses what was paid out beyond it.
- [x] Web: "End stay early" on the stay's page during the stay, with what it refunds.
- [x] Specs: the night arithmetic (tonight, the last night); e2e — the nights are free, the
      refund is right, a payout already sent is reversed.

### 7.5 — A non-refundable rate for a discount ✅

- [x] `@repo/contracts`: `listing.nonRefundableDiscountBps` (nullable, 1% to
      `MAX_NON_REFUNDABLE_DISCOUNT_BPS` = 50%), `createBookingSchema.rate`
      (`STANDARD | NON_REFUNDABLE`, optional, `STANDARD` when left out). `quoteStay` moved
      into the contract so the booking form quotes both rates by the rule the hold is
      charged by: it takes the discount off the total once, with one rounding (half up, in
      the guest's favour); the nights keep their undiscounted prices and `discountCents`
      holds the difference, so `amount = Σ nights − discount`, checked against
      `MIN_CHARGE` / `MAX_CHARGE` after it. `bookingDetailSchema.discountCents`.
- [x] Prisma: `listings.non_refundable_discount_bps`
      (`listings_discount_within_contract`), `bookings.discount_cents`
      (`bookings_discount_within_amount`). `create` reads the discount under the same
      `FOR UPDATE` as the policy, refuses the rate on a listing that does not offer it
      (`400`) and freezes `NON_REFUNDABLE` as the booking's policy. A listing under the
      `NON_REFUNDABLE` policy offers no such rate (`listings_rate_beside_refundable_policy`,
      the contract's refinement for a body naming both, a `400` for a `PATCH` naming one).
- [x] A guest's cancellation refunds nothing, and the grace period does not apply; a host's or
      an admin's still refunds in full — `CANCELLATION_TERMS.NON_REFUNDABLE` already says
      so, nothing new in `refundQuote`.
- [x] Web: the switch and the percentage on the listing form; both rates with their totals on
      the booking form (`RateChoice`, `stay-quote.tsx`), the cancellation quote under the
      chosen rate; the discount on the stay's page. A rate whose total one payment cannot
      carry is disabled unless chosen, its terms still shown, and the quote says why — naming the other
      rate when that one fits (`stayCharge`) — while the submit is withheld; `MIN_CHARGE` /
      `MAX_CHARGE` moved into the contract beside `chargeRefusal`, which the API applies
      itself and answers in a `422`. The catalogue still
      shows and filters by the base price. `switch` and `radio-group` added to `@repo/ui`.
- [x] The seed: two listings offer the rate, one stay is booked at it.
- [x] Specs: `pricing.spec.ts` (the discount, its rounding, the odd cent at the deepest
      discount); e2e — the guest's cancellation refunds 0, the host's and the admin's 100%, a
      listing without the rate refuses it, the floor applies after the discount, a 50%
      discount of an odd total is stored, the discount round-trips through
      `POST`/`PATCH`/`GET /listings`, the rate is refused beside the non-refundable policy
      whichever half a save names, the three `CHECK`s hold against raw writes.

### 7.6 — Check-in in the listing's own time zone ✅

- [x] `listingSchema` gains `timeZone` (an IANA name or `UTC`, never an offset, checked
      through `Intl` — `timeZoneSchema`) and `checkInTime` (`HH:mm`), both optional on a save
      (`UTC` / `15:00` for a new listing) and frozen onto the booking under the policy's lock;
      `checkInInstant` (`check-in.ts`) is `from` at `checkInTime` in `timeZone`. Every refund
      window, the fee's tiers, `isCancellableOn` (the instant, not the UTC day — and never a
      stay ended early) and `payoutDueAt` follow from it; the payout sweep cuts by the
      moment itself, stored as `bookings.check_in_at` when the hold is taken. A zone is
      stored as `Intl` resolves it, a renamed one under IANA's name of today, and an offset
      is refused however it is spelled — `+05:00`, `Etc/GMT±N`, or `EST`, which `Intl` turns
      into `America/Panama`. A response carries the zone unchecked, since the reader's
      `Intl` is not the API's.
- [x] `mayEndEarly` and `earlyCheckOut` follow it too: an early end is offered from the
      instant a cancellation stops, never before it, and "tonight" is the listing's night
      (`stayDay`), not the UTC one. `BookingCancellationService` refuses a stay with
      `ended_early_at` as the backstop, and `isCancellableOn` refuses it too, so neither the
      API nor the stay's page (`mayCancel`) offers "Cancel" for one.
- [x] Backfilled `UTC` / `00:00`, so nothing already booked moves.
- [x] Which check-in day is gone is the listing's too: a day before its today
      (`isCheckInDayPast`, `stayDay`) is refused under the lock that takes the hold —
      a night already over in Adelaide is not sold, tonight in Honolulu is, whatever day
      UTC has reached. `createBookingSchema`, which knows no listing, refuses only a day
      gone everywhere (`earliestToday`, UTC−12); the booking form checks the listing's day
      too (`createBookingSchemaIn`), and the listing page draws the calendar and starts the
      form at it. The waitlist refuses the same day, and writes when it ends there on the
      entry (`waitlist_entries.check_in_day_ends_at`, `checkInDayEnd`): every read of the
      list, and the search for waiters when nights come free, drops an entry from that
      moment, since a query cannot convert a day into the listing's zone. A date price
      is bounded by `earliestToday` too — written and read from it, not from UTC's today
      — or tonight in Honolulu after midnight UTC would be quoted at the default price,
      charged at its date's, and lose that price at the host's next save. The catalogue's
      date boxes start at `earliestToday` as well, so tonight in Honolulu can be searched
      for; a listing further east where that night is over may still be answered, and its
      page draws the night as past and the form refuses it — a filter by each listing's
      own today would be raw SQL on Postgres's zone data, which is not the `Intl` every
      other rule converts with. Left on UTC days: `isReviewable`, which is about no place.
- [x] Web: the two fields on the listing form (`CheckInFields`); the check-in beside every
      policy, and every date of a cancellation or a refund on the stay's page and the
      listing's — the windows, the cancellation, the early end, an admin's partial refunds —
      shown in the listing's time with the zone named (`formatMomentIn`). A zone is stored
      under IANA's name of today and read through `runtimeTimeZone`, which falls back to
      the older name IANA keeps as a link where a browser's zone data predates the rename
      (`Europe/Kiev` for `Europe/Kyiv`). A host's fees keep UTC: the ledger spans every
      listing of theirs and carries no zone, and it is an account's moment, the step in
      phase 8.
- [x] The seed spreads the listings over zones from UTC−10 to UTC+10:30.
- [x] Specs: `checkInInstant` across a change to summer time, a time the clock skips and the
      far zones (UTC−10, UTC+14), the windows, `isCancellableOn`, `mayEndEarly` and
      `payoutDueAt` measured on the listing's clock; e2e — a payout due by the new
      `payoutDueAt` found by the sweep to the millisecond, the fields round-trip and are
      copied onto a stay, the `CHECK`s on the format.

## Phase 8 — Production polish

- [x] Tests: unit tests for the services, e2e over the whole booking and payment cycle (Stripe mocked), the concurrency test from phase 4.
- [x] CI: GitHub Actions — `lint`, `check-types`, `test`, `build` with the turbo cache; a badge in the README. The e2e specs run too, as a second job against Postgres and Redis service containers ("Continuous integration" in `README.md`).
- [x] Rate limiting (`@nestjs/throttler`) on the auth endpoints — pulled forward into phase 2: argon2 turns an unlimited `/auth/login` into a memory amplifier, so it could not wait.
- [x] Helmet. `helmet` on every answer of the API (`src/common/security-headers.ts`),
      its defaults but `upgrade-insecure-requests`, registered before `/docs` so the one HTML
      page gets them too; the frontend's BFF passes them on but HSTS, which is the frontend
      host's own to set. `app.useSecurityHeaders()` is Nest 12's, so the package it is.
- [x] Bring Swagger up to a complete description with examples and auth. One builder,
      `createOpenApiDocument` (`src/common/openapi.ts`), serves `/docs` and is what the spec
      checks: a description of the session, errors, paging, money and limits; a summary and
      a listed tag on every route; the refresh cookie as a second scheme on the two routes
      that read it; the pipes' `400`s, the guard's `401` and the limiter's `429` added to
      the finished document where they apply rather than decorated by hand, a path id
      `ParseUUIDPipe` checks drawn as a uuid; an example on every request body, typed as
      the contract's input, parsed by a spec and required by another. See "main.ts" in
      `apps/api/CLAUDE.md`.
- [x] Observability: structured logs (pino), request logging, `/health` (`@nestjs/terminus`).
      `nestjs-pino` behind every Nest `Logger` from its first line, a failed boot included —
      JSON in production, `pino-pretty` in development, the level named and the time ISO,
      without the route-by-route listing of every boot in production — and a line per
      request from pino-http. One departure: the request log is middleware rather than the
      planned interceptor, since an interceptor runs after the guards and would miss the
      `401`s and `429`s they answer; mounted first in `main.ts`, ahead of the body parsers,
      so their `400`s and `413`s are logged too. The request is logged by an allowlist, not
      by redacting a full dump of headers, and by its path without the query string; a
      client that left before its answer is a `499`; an `X-Request-Id` is adopted or minted
      and sent back. `GET /health` is readiness — Postgres and Redis, both through
      indicators of its own — and is what the Railway deploy now waits on (`healthcheck` in
      `.railway/railway.ts`). See "main.ts" in `apps/api/CLAUDE.md`.
- [x] **Every line on stdout is JSON.** While Redis cannot be reached, the connections of
      the BullMQ queues and workers wrote `Error: connect ECONNREFUSED …` with its stack
      straight to stderr — BullMQ's `emit` falls back to `console.error` when an `error`
      event has no listener — over a thousand lines in ten seconds. Every queue and worker
      now listens (the queue adapters in their constructors, the processors through
      `@OnWorkerEvent("error")`, registered as the worker is created) and reports through
      `RedisOutage` (`src/common/redis-outage.ts`): a warning when a client loses Redis, a
      line when its backend is `ready` again, nothing between. `RealtimeService`, which
      warned on every retry, goes through it too. An error that is not about the
      connection, while it is up, is logged as an error each time.
- [x] **One request id from the browser to the database.** The API adopts an
      `X-Request-Id` or mints one, but in production nothing ever sends it one: the browser
      reaches it only through the BFF, which forwards neither its own id nor anyone
      else's, so the lines of the frontend and of the API cannot be joined.
      Done: the BFF mints an id for every proxied request, sends it upstream as
      `x-request-id` (`REQUEST_ID_HEADER` of `@repo/contracts`), answers with it — the
      `502` and `500` it writes itself included — and logs it with a line of its own,
      `_app/bff/request-log.ts`, in the shape of the API's, beside Vercel's `x-vercel-id`.
      An id the browser sent is dropped rather than kept: the BFF is the edge, the browser
      reads the id off the answer, and a kept one could be anybody's. A server render still
      reaches the API without one and is named there.
- [x] **The admin's side of what the money paths set aside.** The API half is done (see
      "Payments" in `apps/api/CLAUDE.md`), with two departures from the routes below: the
      failed events are `GET /payment-events/failed`, a path rather than a one-value
      `status`, and the stuck retry is two literal routes, `.../stuck/refund/retry` in the
      booking module and `.../stuck/payout/retry` in the payout module, because only the
      payout module may send a transfer. Both retries queue the job at once instead of
      waiting for the sweep. The screen is `/admin/payments`, a tab per list, and the four
      notices lead to their tabs (see "Roles" in `apps/web/CLAUDE.md`). The API already keeps all of
      it and tells every admin (`PAYMENT_EVENT_FAILED`, `REFUND_FAILED`,
      `CANCELLATION_REFUND_FAILED`, `PAYOUT_FAILED`), but the only way to act on any of it
      today is SQL. Three pairs of routes behind `@Roles(Role.ADMIN)`, and a screen under
      `/admin` for them:
  - `GET /payment-events?status=failed` — the events the worker set aside after
    `MAX_EVENT_ATTEMPTS`, with `type`, `attempts`, `last_error` and `received_at`; and
    `POST /payment-events/:id/retry`, which clears `failed_at` and `attempts` so the sweep
    picks the event up within a minute. The usual order is a fix deployed first, then the
    events retried; the handlers are idempotent, so a retry is safe.
  - `GET /refund-failures?status=open` — the refunds a guest's bank sent back, with the
    stay they belong to; and `POST /refund-failures/:id/resolve`, which stamps
    `resolved_at` with a note of how the money went back. No "send it again" button: the
    usual reason is `expired_or_canceled_card`, and the same card refuses it again — the
    money goes back outside Stripe, and what the API records is that it did.
    "The stay they belong to" is a relation, not a bare column: `refund_failures.booking_id`
    has a foreign key to `bookings` with `ON DELETE SET NULL`, so the list joins the stay
    in one read and the screen links each row to `/bookings/:id`. `SET NULL` rather than
    `Restrict` or `Cascade`, which is why the table first had no relation: a guest who
    deletes their account takes their bookings with them (`guest` is `Cascade`), and the
    record of the money has to outlive that row — it keeps `payment_id`, and a `null`
    booking already means "no row names the payment any more". A failure recorded while
    the stay is being deleted fails on the key, the job retries, and the retry finds no
    stay and writes `null`. `payment_events` stays without one: an event is not about one
    stay, and its payload is what names it.
  - `GET /bookings/stuck?kind=refund|payout` — the owed refunds and the host payouts set
    aside after `MAX_REFUND_ATTEMPTS`/`MAX_PAYOUT_ATTEMPTS` (`CANCELLATION_REFUND_FAILED`,
    `PAYOUT_FAILED`), with the stay, the attempts and the last error; and
    `POST /bookings/:id/stuck/:kind/retry`, which clears `*_failed_at` and `*_attempts` so
    the sweep takes the row again. Retried rather than resolved by hand: the debt and the
    transfer are still on the row, and the sweep is what sends them.
  - The frontend renders the four admin notices with a link to the screen.
- [x] **The payment form opens the payment once.** `POST /bookings/:id/payment` is safe to
      repeat one after another, but not at the same moment: Stripe refuses a second request
      under the same idempotency key while the first is in flight, and the API answers it
      `409` ("being opened by another request — try again"). The form has to call it once per
      mount — single-flight, the way the transport refreshes a session — survive React's
      Strict Mode running the effect twice and a double click, and read that `409` as a
      retry after a short pause rather than as a hold that stopped waiting for payment.
      Done in the form alone: the query cache already reuses a request in flight, so the
      Strict Mode mount and a remount land on the one `POST`, and "Try again" puts the
      query back to pending, which takes the button away; what changed is the `409`. Each one has the page read the booking again and is asked
      again a second later, up to four times, the skeleton still drawn — a hold that moved
      on takes the form off the page, which stops the retries, and one still waiting gets
      the secret from the request that won (`CONFLICT_RETRIES` in `payment-form.tsx`).
- [x] **Authorize the hold, capture the stay.** The guest is charged at once today, so a
      payment that lands on a lapsed or cancelled hold is a full charge and a full refund,
      and Stripe keeps its processing fee on both. Opening the intent with
      `capture_method: "manual"` makes a hold an authorization: `confirmPayment` captures
      it, a lapsed or cancelled hold cancels it at no cost, and a late payment is a
      cancellation instead of a refund. What it costs: `payment_intent.amount_capturable_updated`
      becomes the event that confirms a stay, an authorization lapses after seven days for
      cards (fine for a fifteen-minute hold), and the methods without manual capture —
      iDEAL, Bancontact, EPS, MB WAY, Zip — have to stay on immediate capture, so
      `INSTANT_PAYMENT_METHODS` splits in two.
      Done: `MANUAL_CAPTURE_METHODS` are opened with `capture_method: "manual"` each in
      `payment_method_options`, `IMMEDIATE_CAPTURE_METHODS` (Wero joined the list above)
      keep the automatic one. The authorization is captured and the stay confirmed in one
      run of the `authorized` event under the stay's lease, through the `confirmOrRefund` a
      `succeeded` already went through; one that no longer confirms anything is withdrawn.
      A capture that leaves the intent `processing` ends the run, and the capture's own
      `succeeded` confirms the stay. Wero stays on immediate capture: its page lists manual
      capture, but the pinned API has no option to ask for it. One departure: the guest
      whose authorization is let go gets no notice — nothing was taken, and the stay's page
      already says the hold is gone. See "Payments" in `apps/api/CLAUDE.md`.
- [x] **Money as whole cents, named by its unit.** The contract used to speak dollars as a
      `number` exact to the cent, and the API did arithmetic on it, which is why
      `roundCents` sat after nearly every subtraction. Now every amount is a whole number of
      cents from the database to Stripe: the columns are `integer` and named `*_cents`, the
      contract's fields `*Cents`, and both sides parse them into `Cents`, a branded type of
      `@repo/contracts` (`store_money_in_cents`, which also moved the inbox's payloads and
      the stored notices). The platform's fee is basis points, the host's share rounded once
      and the fee the rest. A booking stores its `currency` and the nights its amount adds
      up from (`booking_nights`, answered by `GET /bookings/:id`). Turning cents into the
      currency itself is `apps/web`'s job alone, at one edge — `formatMoney` out,
      `centsFromInput` in. Details are "Payments" in `apps/api/CLAUDE.md`.
- [x] **JSON-LD across the whole site** — the structured data a catalogue is actually read
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
        vacation-rental result is a partner programme, so this is structured data a
        crawler reads the page by rather than a rich result: outside the programme Google
        asks for photos, an address and coordinates the contract does not hold, and a
        nested `Offer` draws no price on its own.
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

      Done: `JsonLd` over `serializeJsonLd` (`shared/lib/json-ld/`, a spec on the
      `\u003c`; the modules with a spec in `shared/lib` moved into folders of their own to
      make room under Steiger's grouping threshold), the shell's `Organization` and `WebSite` as one `@graph`, the catalogue's
      `ItemList` of the rows it drew, and the listing's `VacationRental` holding an
      `Accommodation` (`occupancy`) and making an `Offer` at the default nightly price,
      each page with its `BreadcrumbList`. Every absolute URL is built on `siteOrigin()`
      (`SITE_ORIGIN`, else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, else this machine's
      port), which is the root layout's `metadataBase` too; it reads a bare host as
      `https` and passes over a value that is not an address rather than letting
      `metadataBase` throw on every page. The listing's `generateMetadata` states its
      title, a description cut to a result's length (`descriptionSummary`) and
      `openGraph` off the same cached read the page renders (`readListing`). Specs cover
      `siteOrigin()`, the indexing rule, the summary and both JSON-LD builders.

      Four departures from the above:

      - **Only the bare `/listings` is indexed.** A filtered search does not canonicalise
        to itself: an ordering is the first page reordered, a price or a guest count is
        unbounded and near-identical to its neighbours, and a pair of dates stops being a
        search the contract takes the day it passes — each one a duplicate under one
        title. Every search, cursor page and refused search is `noindex, follow`.
      - **None of those names a canonical**, the cursor page included: `noindex` beside a
        canonical pointing elsewhere is the mixed signal Google advises against.
      - **`sitemap.xml` and `robots.txt` came with it** (`_app/seo`), since a catalogue
        whose later pages are `noindex` leaves a crawler no other road to most listings —
        Google stops following the links of a page left out for long. The sitemap names
        the home page, the catalogue and every listing with its `updatedAt`, read through
        the unfiltered catalogue at `MAX_PAGE_LIMIT` (now exported by
        `@repo/contracts`) under `CATALOGUE_TAG`; `robots.txt` keeps a crawler out of the
        BFF and of the proxy's `PROTECTED` sections. Both are rendered per request.
      - **An `AggregateRating` is in**, because the shared reviews arrived first: off the
        listing's review summary, once somebody has rated it; `Review` items are not.
        Google draws no stars for it — a `LocalBusiness` subtype rated on its own site is
        self-serving by its rules — but it is the page's fact, stated. The `ItemList` is
        left out on an empty page, where it would state nothing.
      - **The sign-in and sign-up forms are `noindex, follow`** — a form is not content,
        and every `?next=` is another address of it.

- [x] **An account's moments on the reader's clock.** The notices, the messages, "Blocked
      since", a host's fees, the admin's lists of what was set aside and a hold's deadline
      were said in UTC (`formatMoment` + ` UTC`): they have no place of their own, so
      the reader's zone is the right one, and a server render does not know it — formatting
      in the browser's zone on one side only is a hydration error. A stay's moments stay on
      the listing's clock (7.6) and a calendar day on none; this is the third kind only.
  - The browser writes its zone into a cookie (`Intl.DateTimeFormat().resolvedOptions()`,
    checked by `canonicalTimeZone`), and a server render reads it through `cookies()` and
    formats in it with the zone named, so both sides render the same text and nothing
    flickers. No cookie yet — a first visit — is UTC, as now.
  - Only on pages that are personal already: `cookies()` makes a render dynamic, and the
    public cached reads (the catalogue, a listing, its reviews) must not depend on it.
    None of them states such a moment; the rule goes into `apps/web/CLAUDE.md` with it.
  - A hold's deadline also counts down ("12 minutes left") beside the time, since what it
    asks of the guest is to pay now.
  - Not a profile setting: that is a column, a contract field and a screen for what the
    browser already knows.
  - Done: `TimeZoneCookie` in the shell writes the cookie (`time_zone`) whenever it is
    missing or differs and refreshes a signed-in render once; `readerTimeZone()` reads it
    on each personal page, which hands it down as a prop to whatever states such a moment
    (`formatMomentIn`), and the bell's popup, drawn only in a browser, uses
    `browserTimeZone()`. The cookie is checked by `canonicalTimeZone` and, past it, takes
    the fixed offsets a reader's clock may be on and a listing's may not (`Etc/GMT-3`,
    stated as `UTC+3`). "Joined" and "Member since" are read on the reader's clock too
    (`formatDate`); a review's date stays UTC's, since the listing's reviews are a public
    cached read. The hold's deadline is `HoldDeadline` (`entities/booking`): the time and
    the minutes left, counted from the server's `now` and then the browser's clock, at
    once when that already says otherwise.

- [x] Reviews with ratings.

## Phase 9 — Deployment and presentation

- [x] Web on Vercel; API + Postgres + Redis on Railway or Fly.io. `API_ORIGIN` is a runtime variable of the frontend server, so a changed API address is a redeploy without a rebuild; `TRUST_PROXY` on the API has to reach past the extra `X-Forwarded-For` entry the frontend server's own request produces.
- [x] The README as a pitch: the top of `README.md` now reads as one — what it does, the double-booking GIF and three screenshots (`docs/images/`), a Mermaid architecture diagram, an "Interesting decisions" section (concurrency, webhooks, authorize-then-capture, money in cents, the shared contract, session rotation, leases) and the demo logins and test card. One departure: the quick start stays the six commands it takes (Stripe keys, Docker, migrate, seed) rather than three. The live demo is linked from the first lines.
- [x] The demo scenario: two browser windows book the same slot at once — one goes to payment, the other receives a polite conflict. The API's `409` used to name the listing's uuid and the dates (`Listing … is already booked for an overlapping range`); the guest now reads a sentence that says the nights are no longer free and what to do next (`DATES_UNAVAILABLE`; the error's own message, with the ids, goes to the API's log). The GIF was recorded once with Playwright driving two signed-in browser contexts; the script is not kept in the repository, so as not to add a browser-automation dependency for one recording.

## Phase 10 — Error codes from the API

The interface is English today, and that is a rule rather than an accident
(`.claude/rules/workflow.md`). Localizing it is not planned here; what this phase does is
the one piece of it that is a contract change and would be paid for twice if it were left
until the screens move: **a refusal answers with a stable code, not only a sentence.** Today
it is English prose written in a zod schema or a Nest exception, and it reaches the screen
as it is — `form-errors.ts` puts it under the field it names. A client that wants to word a
refusal differently, or in another language, would have to match the text, which is a parser
over somebody else's prose.

The phase stops at the API's side of the wire. No catalogue, no `next-intl`, no `[locale]`
segment: those come back as their own phase if the interface is ever translated.

- [x] **A code on every refusal.** `apiErrorSchema` grows `code`, and `apiErrorIssueSchema`
      grows `code` and `params` (the minimum, the ceiling, the date the rule already knows).
      The codes are one list in `@repo/contracts` (`ERROR_CODES`), so the API cannot invent
      one the other side has never heard of. `message` stays as it is — the English
      sentence is the fallback for a client that knows no code, and what `/docs` and the
      logs keep saying.
- [x] **Rules carry their code.** A zod rule is written `error: rule("PASSWORD_TOO_SHORT",
"Password must be at least 8 characters long", params)`; the helper stamps the code onto
      the raw issue, so it survives to the wire and to the browser's own parse of the same
      schema. An issue no rule claimed (zod's own "expected string") gets `INVALID_INPUT`.
- [x] **Exceptions carry theirs.** `apiException(NotFoundException, "BOOKING_NOT_FOUND",
message, params?)` in `apps/api/src/common`; a global filter guarantees the field on
      every answer — an exception nobody migrated yet (a Nest 404 for an unknown route, the
      throttler's 429) gets a code per status (`NOT_FOUND`, `TOO_MANY_REQUESTS`, …), a
      body the parser refused gets its status's, an unexpected error is a bare
      `INTERNAL_ERROR` (logged with its stack, as Nest's own filter did), and a status with
      no code of its own is `UNKNOWN_ERROR` rather than a guess.
- [x] **Migrated slice by slice**, each one a change that lands whole: auth ✅ (its schema
      rules, `AuthService`, `RolesGuard`, and the session and admin-standing refusals every
      service shares, `common/session-errors.ts`), listings ✅ (the contract's listing,
      check-in, date and window rules, `ListingService`, the `:id` of its paths through
      `ParseIdPipe`, the days of a search and of an availability window worded like any other
      day, and the two refusals of a keyset cursor in `common/paging.ts` —
      `CURSOR_MALFORMED`, `CURSOR_ORDERING_MISMATCH`), bookings and cancellations ✅ (the
      stay's days, a cancellation's reason, an admin's refund and an early end's check-out in
      the contract; `BookingService`, `BookingCancellationService`,
      `BookingEarlyEndService` and `BookingAdjustmentService`, with `bookingNotFound` in
      `stay-reader.ts` for the `404` they share; the `:id` of the booking routes through
      `ParseIdPipe`; a stay no payment can carry is `STAY_TOO_EXPENSIVE` or `STAY_TOO_CHEAP`
      with the bound it crossed in `params`), payments and payouts ✅ (what the money paths
      set aside and what an admin does about it: `writeOrRefuse` takes a code and a sentence
      for each of its two refusals, so a retry or a resolution that matched nothing is
      `PAYMENT_EVENT_NOT_FOUND` / `_NOT_SET_ASIDE`, `REFUND_FAILURE_NOT_FOUND` /
      `_ALREADY_RESOLVED`, `BOOKING_NOT_FOUND` with `REFUND_NOT_SET_ASIDE` or
      `PAYOUT_NOT_STUCK`, `HOST_FEE_NOT_FOUND` / `_NOT_OWED`; the payout account's `502` is
      `PAYOUT_ACCOUNT_UNAVAILABLE`; the two webhooks answer `WEBHOOK_SIGNATURE_MISSING` and
      `WEBHOOK_EVENT_INVALID`, which no browser reads but the provider's dashboard and the
      logs show; the contract's window over what was set aside, its provider-id and
      event-type filters, a resolution and a waiver's reason carry their codes, and the
      window's order waits for two readable days like a stay's check-out rule does; the `:id` of a host
      fee and of a stuck payout's retry goes through `ParseIdPipe`), and the rest ✅: reviews
      (the rating's and the comment's rules, `GUEST_NOT_FOUND`, `REVIEW_NOT_FOUND`,
      `STAY_NOT_REVIEWABLE`, `REVIEW_ALREADY_WRITTEN`), conversations (the message's and
      the listing's rules, `CONVERSATION_NOT_FOUND`, `CANNOT_WRITE_TO_YOURSELF`), the
      waitlist (`WAITLIST_OWN_LISTING`, `WAITLIST_FULL`, `WAITLIST_NIGHTS_HELD_BY_YOU`,
      `NIGHTS_AVAILABLE`, `WAITLIST_ENTRY_NOT_FOUND`, the booking's `CHECK_IN_DAY_PAST`),
      notifications (`NOTIFICATION_NOT_FOUND`), lookups (`LOOKUP_TOO_SHORT` / `_TOO_LONG`)
      and users (`USER_NOT_FOUND`, `ADMIN_ACCOUNT_CANNOT_BE_BLOCKED`, the name and address
      filters' rules), every `:id` of those routes through `ParseIdPipe`, and the
      `LISTING_NOT_FOUND` of bookings, reviews, waitlist and conversations from the one
      `listingNotFound` in `listing/listing-not-found.ts`. Nothing is thrown bare any more:
      the `never` branch of an exhaustive role switch answers `ROLE_NOT_ALLOWED` in every
      service that has one. A malformed listing id in a new thread's body is
      `LISTING_ID_INVALID` apart from a missing one (`LISTING_REQUIRED`), and a rating that
      is no number `RATING_NOT_A_NUMBER` apart from one that is no whole star. Three things of
      that slice reached the others before they were migrated, because they are shared code: `readCursor` answers the two cursor codes for
      every paged read (stays, reviews, waitlist, conversations, notifications, lookup,
      users, refund failures, payment events), `dayMessage` stamps `DATE_REQUIRED` and
      `DATE_INVALID` onto the stay's `from` and `to` as well, and `ParseIdPipe` is what a
      slice swaps its `ParseUUIDPipe` for (`INVALID_ID`) — each slice asserts these in its
      own e2e spec when it lands. A `Listing … not found` raised outside this slice —
      bookings, reviews, waitlist, conversations — takes `LISTING_NOT_FOUND` in the slice
      that raises it. The e2e spec of a slice asserts the code next to the status.
- [x] **The web branches on a code where a status is ambiguous.** The interface decides by
      HTTP status today, which is right wherever a status has one reason (`404` is a missing
      row, `401` a dead session, `400` on a read a stale cursor) and wrong where it has
      several. Those are the places to move onto a code, each in the change that migrates the
      slice raising it, since the code has to exist first:

  - `payment-form.tsx` ✅ — a `409` was both "the hold moved on" and "another request is
    opening this payment", and the form retried on either; it now retries on
    `PAYMENT_BEING_OPENED` only, and on `BOOKING_NOT_AWAITING_PAYMENT` reads the booking at
    once, which takes the form away.
  - `refund-stay-action.ts` ✅ — a `409` is a dispute, Stripe's refusal, more than is left to
    refund, a claim another press holds, or a stay that moved on; the action refreshes the
    list only after the codes that may have let a claim go (`mayHaveReleasedClaim` in `model/refund-claim.ts`). The
    dialog still shows the API's `message`; wording it from the code is the interface's
    own change, and out of this phase.
  - `create-booking-action.ts` ✅ and `join-waitlist-action.ts` ✅ — a `409` was read as "the
    calendar is stale", true only because nothing else in those routes answered one; the
    booking action now checks `DATES_UNAVAILABLE`, so a second `409` added later cannot
    flip the form into the waitlist offer, and the `412` is `LISTING_CHANGED_SINCE_SHOWN`.
    The waitlist action moved with the waitlist slice and checks `NIGHTS_AVAILABLE`, so its
    full list (`WAITLIST_FULL`, a `403`) and any later `409` leave the calendar alone.
  - `keyset-page.ts` stays on `400`: a stale cursor is the only `400` a read answers, and
    the filter's `VALIDATION_FAILED` already tells a refused search apart from it.

  What stays on status: `not-found.ts`, `auth.ts` and the retry-on-`401` of the transport.

- [x] **The web's transport reads it.** `ApiResponseError` keeps `code` and the issues'
      `code`/`params` beside the message, and nothing else changes in the interface: it
      still shows `message`.

What stays out: everything that touches the interface — a catalogue, a locale in the path,
`proxy.ts` composed with a locale middleware, formatters, `<html lang>`, the SEO of two
languages. A listing's title and description stay their author's text.

## Phase 11 — End-to-end tests of the frontend

Phase 8's tests stop at the HTTP surface: the API's e2e specs prove the rules, and the
frontend's Vitest suite deliberately covers no component. So nothing yet proves that a
visitor can actually _do_ anything — that a form submits what the API accepts, that signing
in keeps a visitor signed in, that a page shows the state the API answered. Today that proof
is a person clicking through the site; the goal of this phase is a green run that answers
"does the app still work" for the main things a guest, a host and an admin do with it.

It comes last because it needs screens that have stopped changing, and it is written against
what a visitor perceives — roles, labels and the visible English text — not how the page is
produced, so it survives a rewrite of how pages are cached or rendered.

The suite proves the main use of the application and nothing the API's specs already prove.
A scenario is a goal a visitor sets out to reach, walked once through the real pages when
things go right; its edge cases are rules the API's e2e specs and the contract's Vitest
suite prove on every pull request at a fraction of the cost. What only a browser can prove is
that the pages, the forms, the proxy to the API and the session hold together. The scenarios,
by priority and written as what a visitor does, are in `docs/e2e-scenarios.md`, together with
the rules every scenario follows and the rule that every page they visit is checked for
errors and accessibility; a tick there means written and green. This phase records the
decisions and constraints under them.

Four steps, each its own branch and pull request, in this order: the hermetic stack; the
payment stand-in and the scenarios; real Stripe on the local stack; the live deployment.
Every step ships only code a spec of that step runs, so a stop after any of them leaves a
suite that works. The last two are optional: their outline is here, and their details are
settled when they start, once 11.2 has run green.

The plan records decisions and the constraints behind them. How a piece is built — commands,
variables, names, helpers, the order of a start-up — belongs to the code and its comments,
and the rules that outlive the phase move into `apps/web/CLAUDE.md` and `apps/api/CLAUDE.md`
with it.

Out of scope for the whole phase, besides every edge case the other suites prove: component
tests (a browser run covers a component through its page), screenshot comparisons (a pixel
diff asks a person to approve every change), browsers other than Chromium, and viewports
other than desktop and one phone.

### 11.1 — The hermetic stack and the CI job

The step ships the three scenarios of `docs/e2e-scenarios.md` that prove the stack itself
rather than a function of the application — signing in and out, the page behind the
session and the broken link — so every piece of it runs in a spec, an expected not-found
answer included. The CI tick waits for the job's first green run on GitHub, and making it a
required check is a setting of the repository.

- [x] **A browser suite for the frontend**, with a command of its own apart from the API's
      e2e. It sees the application the way a visitor does, on a reader's clock that is the
      same on every machine, and a failure leaves enough to diagnose it without a rerun.
- [x] **A hermetic stack that the suite starts itself.** The production builds of the
      frontend and the API, with a database and a cache of their own that nothing else uses,
      so a run can never wipe the development stack. Every run starts from the same clean
      state, with the demo data and no page cached by an earlier run. The suite can be run
      unattended, which is possible because the reset can only ever reach its own database.
- [x] **Stripe is off in this stack.** Nothing in a run reaches Stripe, and a deployment
      cannot be started in that mode. The API's own e2e specs stay green on this change.
- [x] **Tests do not depend on each other**, by the rules in `docs/e2e-scenarios.md`: a
      retry never meets what the first attempt left, and the demo accounts, which are
      shared, are only signed in to. One test's traffic never gets another's refused by the
      API's limits.
- [x] **Every page is checked**, by the rule in `docs/e2e-scenarios.md`.
- [ ] **CI.** A job of its own beside the existing checks and the API's e2e: build, run, and
      keep the report and a failure's traces.
  - **It runs on every pull request, with no path filter**: a change to `@repo/contracts` or
    `@repo/ui` reaches a screen without touching `apps/web`, and a required check skipped by
    a filter stays pending forever. It is required from the day it merges. Its budget is ten
    minutes; a run that nears it is the signal to shard, not to raise the number.
  - **One retry in CI**, on the hermetic stack only. A test that passes on the retry is
    reported as flaky; a test seen flaky twice is fixed or removed, not given more retries.
  - **One worker, here and on every target later steps add**, because the tests share the
    demo accounts.
- [x] **Documentation.** The command, the CI job and the rules of the suite are recorded where
      `.claude/rules/workflow.md` already sends them, including the rule that a change
      reaching a screen runs the browser suite. `apps/web/CLAUDE.md` records what belongs in
      it: a scenario's main path, never an edge case.

### 11.2 — The payment stand-in and the scenarios

The first scenario that pays brings what money needs with it, so none of it ships before a
spec runs it. The scenarios come in three parts, each its own pull request, so a stop between
two leaves the finished ones standing.

#### 11.2a — The payment stand-in and the arrangement of a scenario's state

- [ ] **A stand-in for Stripe on the hermetic stack.** Every place a scenario's money meets
      Stripe is replaced by something that behaves the way Stripe does from the application's
      side: a card is accepted, the payment is confirmed, a refund is made and reported back
      later. No scenario's result depends on Stripe being reachable, and a request that
      still reaches Stripe fails the test instead of leaving CI. The suite does not type into
      Stripe's own card form, whose markup is Stripe's to change. A declined card and 3-D
      Secure are the payment's edge cases and stay out.
- [ ] **A listing per test.** Every scenario that books has a listing of its own, so no two
      tests compete for a night and a retry never meets the hold its failed attempt left.
      These listings stay out of the catalogue scenario's way.
- [ ] **A stay that has begun.** Ending a stay early and reviewing one need a stay whose
      check-in has passed, and the seed's only one is not to be changed. So such a scenario
      makes its own, on a listing whose time zone has already started the check-in day, and
      pays for it through the pages.
- [ ] **Arranging state never reaches money.** What a scenario should not click its way to —
      above all its listing — is arranged before it starts, by the application's own means
      and not by writing to its database, so the same arrangement works on every target. A
      stay is always paid through the pages, so a scenario reads the same on every target.

#### 11.2b — The scenarios

- [ ] **The scenarios of `docs/e2e-scenarios.md`**, priorities 1 to 4, written most important
      first; each is its own tick there. Each is marked there with where it runs once 11.3
      and 11.4 add other targets, by the rule in that file.

#### 11.2c — The phone

- [ ] **A second run on a phone viewport** walks the navigation scenario and the catalogue to
      a listing's page, the things a narrow screen changes: how a visitor gets around and what
      they can read. The booking does not repeat on the phone, since the same code answers on
      both. It runs on the hermetic stack alone, since the other targets serve the same code.

### 11.3 — Real Stripe, on the local stack (optional)

One suite, several targets. The hermetic stack is the default and the required check on every
pull request. The second target is the same stack with Stripe's side real, running the
scenarios marked for every target and those marked for real Stripe — how a developer checks
the payment and payout scenarios against Stripe before trusting them against anything else.

- The API runs as it does in deployment, apart from a developer's own running stack, so one
  never hears the other's payments.
- Stripe's confirmations reach the local API, and the suite sets that up and tears it down
  itself.
- A stay is paid in Stripe's own form with a test card, and the suite waits for Stripe's own
  confirmation; a scenario reads the same as on the hermetic stack. It is the only check that
  Stripe still accepts what the integration sends, flaky by nature, so never a required
  check, and with no retries: a failure on Stripe's side is what the target exists to show.

### 11.4 — The live deployment (optional)

A green run against the live deployment is worth having in a portfolio project, but it can
neither replace the hermetic one nor run everything it runs. The step stands on 11.3 and
ships only once the scenarios marked for every target have run green locally.

- It runs only the scenarios marked for every target, against a running deployment, and
  prepares nothing in it that a visitor could not. It is never the default and runs apart from
  the pull request checks — on a schedule and on demand, never blocking a merge.
- **A scenario arranges its state there through the application's own means**, as the host
  account the suite has on the demo: its listing is created by that host, and a stay that has
  begun rests on a listing whose time zone has started the check-in day. What cannot be
  arranged that way is not run there.
- The suite has two accounts of its own on the live demo, a guest and a host, whose password
  is a secret, not a value written in the repository: a password in the repository is one
  anybody can sign in with and change. A taken address that refuses the secret, or a blocked
  sign-in, fails the run — a finding about an open demo, not a hole for the suite to close.
- **Each run leaves the demo as it found it, as far as the application allows**: the stays a
  run made are cancelled and its listings retired after its scenarios, and the same is done
  first for what a run that died left behind. A paid stay that has been ended, or a review,
  cannot be taken back; both stay on a retired listing, out of the catalogue and out of the
  next run's way.
- The whole run is one visitor to the live rate limiter, so its pace is measured on the
  first run and fixed from the numbers. No retries: a retry looks like a new visitor while
  the limiter still remembers the first attempt.
- A stopped demo ends the run with a notice and skips the scenarios; a deployment that is up
  and answers badly fails it.

The addresses, what the hosting platforms report about a deployment and the budget numbers
are read and measured when the step is written, and recorded here then.

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
  The client path stays for what a round trip cannot express — a poll for a webhook — and
  phase 6 is what brings the first of those.
- The order of the phases follows the dependencies: database → auth → roles → concurrency → catalogue → Stripe → cancellation policies → polish → deployment → error codes → frontend e2e. The frontend e2e suite comes last: it needs screens that have stopped changing, and it describes what a visitor sees rather than how the page is produced. The cancellation policies follow Stripe directly because they change the rules its refund machinery runs on, and they come before the error codes because they add refusals the codes would otherwise be written for twice. The catalogue comes before Stripe because the dependency runs one way only: Stripe Elements needs a booking to attach to, and a booking is created from the form on the listing page, which is the catalogue's. Nothing in the catalogue needs a payment — it is server-rendered from `searchParams`, and TanStack Query arrives with the polling of the webhook.

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

- **Partial prerendering (`cacheComponents: true`)** — it was built (commit `deb1721`: the
  reads rewritten to `"use cache"`, a `<Suspense>` boundary around the session in the shell,
  a loading state per route) and measured on the deployed site, signed in, then reverted.
  The plan expected a better time to first byte, and the measurements did not show one:
  - TTFB stayed at about 24 ms on every page, before and after.
  - Lighthouse (mobile profile, 3 runs per page, 20 pages): the score went from 99 to 97,
    9 pages lost 2–4 points and none gained; LCP moved later on 11 pages (0.8–1.0 s → 2.4–2.7
    s, the cause was not isolated); total blocking time was the one gain, 79 → 52 ms.
  - Client-side navigation (16 navigations, 3 samples each, unthrottled and Slow 4G): the
    skeleton appears after about 29 ms with or without it, because the route `loading.tsx`
    files are prefetched either way, and the content was not faster, 346 → 410 ms unthrottled
    and 628 → 647 ms throttled, slower on 4–6 navigations.

  The likely reason is that every page measured is behind a login and shows one user's data,
  so the time to content is set by the API call behind it, which a prerendered shell does not
  shorten. What was not measured: the anonymous pages (`/`, `/listings`, `/listings/:id`),
  where a shell and a cached read are shared by every visitor and the gain should be, and the
  load a cached read takes off the API. If PPR is reconsidered, measure those first, on a
  preview deployment of the branch. The numbers are in `docs/lighthouse-2026-11-17.md`,
  `docs/lighthouse-ppr-comparison.md`, `docs/lighthouse-ppr-navigation.md` and
  `docs/lighthouse-ppr-navigation-comparison.md`.
