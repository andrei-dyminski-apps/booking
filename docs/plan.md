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
`.claude/rules/backend.md`. One departure from it is planned, and only one.

**Everywhere: a repository between the service and Prisma — done.** No service imports the
generated client or the row types any more (the mappers live in the repository), so a unit
test fakes a repository instead of a query builder. It is a rule now rather than a
judgement call: `auth`, `booking` and `listing` all have one, and so does the next module.
Cheap, and it is the step the market means when it asks for "clean architecture".

**In `booking` only: ports and adapters.** Once phases 4–5 land, that module is the one that
earns the full `domain / application / infrastructure / presentation` split:

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
- **`listing` / the catalogue (phase 6)** — read-heavy CRUD with filters and pagination. It
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
earn. Phase 4 adds the locking transaction to the repository that is already there. `domain/` follows
when the statuses arrive in phase 4, and the ports and the use cases when Stripe arrives in
phase 5. Introducing the layers before the rules exist would be a refactor of a CRUD, which
is exactly the overengineering an interviewer notices.

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
second consumer appears — not in anticipation of the screens of phase 6.

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
  because these rules are cheap to satisfy now and a refactor to satisfy after phase 6.
- **The place of a new screen is decided before it is written.** Phases 3–6 add roles, a
  catalogue with filters, a booking form and payment — the kind of growth where a flat
  `components/` folder turns into a pile.
- **`@repo/ui` stays the design system** — the `shared/ui` of the project, generated by the
  shadcn CLI. FSD does not change that: what is domain-free and reusable goes into the
  package, what belongs to one screen stays in the `ui/` segment of its slice.
- The price is the ceremony of a public API per slice. It is paid up front, while the
  frontend is two components — the same reasoning that put the repository step in `auth`
  at the end of phase 2 rather than in the middle of phase 5.

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
- [x] The BFF, and the session moved onto the frontend's own origin with it: the browser calls `/api/...`, the proxy re-issues the two cookies for this host, the login/register/logout forms became Server Actions, and the transport answers a 401 with one rotation and one replay — single-flight per tab and across tabs. See "Decisions already made" for why, and `.claude/rules/frontend.md` for the rules that came out of it.
- [x] The `registerSchema` / `loginSchema` schemas go into `@repo/contracts`: one validation for the form and the request.
- [x] `UserRepository` and `RefreshTokenRepository` in front of Prisma — the repository step of "Layering inside `apps/api`". `AuthService` keeps the rules and no longer imports the generated client, the rotation transaction and the `P2002` translation live in the repository, and the unit spec runs against in-memory fakes: it now asserts what ends up stored (a replayed token revokes the whole family) instead of the arguments of a Prisma call.

## Phase 3 — Roles (RBAC)

The backend is done, and so is the owner's half of the frontend. What waits for phase 6 is
the admin's: it is a view over the whole catalogue, and the catalogue is what that phase
builds.

- [x] A `@Roles(Role.OWNER)` decorator + `RolesGuard`, registered globally after `JwtAuthGuard` — it reads the user that one put on the request. Membership of a set rather than a hierarchy: a route that admins may use names `ADMIN`, so what a role can reach is readable where the route is written.
- [x] The `Listing` model (belongs to an OWNER, `price_per_night` in minor units) and the `listing` module. `Booking` grew up with it: `room_id` and the typed-in `guest_name` became relations to a listing and to a user, because no rule about "their own" can be written against a string.
- [x] **USER** books; **OWNER** creates/edits their own listings and sees the bookings against them; **ADMIN** sees everything, edits any listing and can cancel any booking. `GET /bookings` is narrowed by the role of the caller rather than by a query parameter — the scope is in the `where`, so the query cannot return a row the caller may not see.
- [x] The ownership check stays separate from the role check, and the split is where each of them can be answered: the role is a claim of the access token, so it is a guard; ownership is a property of a row and cannot be known until the row is read, so it lives in the service next to the read (`src/auth/ownership.ts`). A `403` from the guard means "not your kind of endpoint", a `403` from the service means "not your row" — except where naming the row would itself be the leak: nothing lets a stranger list bookings, so an unreadable one answers `404`. Reading and writing are separate rules over the same row as well — an owner reads the bookings against their listing and cannot cancel one.
- [x] On the frontend — conditional rendering by role: `/dashboard` for the owner, with
      the listings CRUD on it (`/dashboard/listings/new` and `/dashboard/listings/[id]`).
      The role decides which screens are offered and which one a visitor is shown, never
      what is allowed: `requireRole` answers `notFound()` for the wrong role, the header
      renders the link for the role that has a use for it, and every request behind both
      is refused on its own merits by `RolesGuard`. It also brought the `features` layer
      into existence — the form is the one thing the new and the edit screen share.
- [ ] `/admin` — the same conditional rendering for the role that sees everything. It
      waits for phase 6: an admin's screen is the catalogue plus the right to edit any row
      of it, so building it before the catalogue would mean building the catalogue twice.

## Phase 4 — Concurrent booking (the centrepiece)

Three layers of protection, from UX down to a guarantee in the database:

- [ ] **The hold**: a booking is created as `PENDING_PAYMENT` with `expiresAt = now + 15 min` — the slot is taken for the duration of the payment. Expired holds are released by a BullMQ job (and lazily, by the availability check).
- [ ] **A transaction with a lock**: creating a booking is an interactive transaction with `SELECT ... FOR UPDATE` on the Listing row; competing requests get serialized and the second one receives an honest `409 Conflict`.
- [ ] **A database constraint as the last line of defence**: the `btree_gist` extension and an **EXCLUDE** constraint over `daterange(from, to)` for active bookings — even a bug in the code cannot write overlapping bookings. Applied as a raw-SQL migration.
- [x] The layering step of "Layering inside `apps/api`": a `BookingRepository` in front of
      Prisma — done at the end of phase 3, see the note in "Layering inside `apps/api`".
- [ ] `booking/domain/` for the statuses, the transitions and the date range.
- [ ] The proof: an e2e test with `Promise.all` over 10 parallel requests for the same dates — exactly one `201`, the rest `409`.

## Phase 5 — Stripe

The full payment cycle through **PaymentIntent**:

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

## Phase 6 — Search and catalogue (the face of the project)

- [ ] A list of listings with filters (dates, price, capacity); filters live in the **URL searchParams** (shareable links), Server Components, cursor pagination.
- [ ] The first cached reads in the application, and with them the rest of the
      revalidation table in `.claude/rules/frontend.md`: a catalogue read carries
      `next: { tags }`, a mutation of a listing answers with `revalidateTag(tag, "max")`,
      and its own author gets `updateTag`. Everything up to this phase is personal data
      read `no-store`, which is why only the first row of that table is in use.
- [ ] `cacheComponents: true` and PPR — worth it once there is a page whose shell is worth
      prerendering. It is not worth it before: the header reads the session in the root
      layout, so turning it on today would mean a `<Suspense>` skeleton around the shell of
      every page in exchange for three screens that are all behind a login.
- [ ] `notFound()` for a 404 from `ApiResponseError`, once there is a detail page that can
      be asked for a row that does not exist.
- [ ] The listing page: an availability calendar from the API, a booking form with a price calculation.
- [ ] "My bookings" with statuses and cancellation.
- [ ] The availability check by dates — the same SQL range-overlap predicate as in phase 4.

## Phase 7 — Production polish

- [ ] Tests: unit tests for the services, e2e over the whole booking and payment cycle (Stripe mocked), the concurrency test from phase 4.
- [ ] CI: GitHub Actions — `lint`, `check-types`, `test`, `build` with the turbo cache; a badge in the README.
- [x] Rate limiting (`@nestjs/throttler`) on the auth endpoints — pulled forward into phase 2: argon2 turns an unlimited `/auth/login` into a memory amplifier, so it could not wait.
- [ ] Helmet.
- [ ] Bring Swagger up to a complete description with examples and auth.
- [ ] Observability: structured logs (pino), a request-logging interceptor, `/health` (`@nestjs/terminus`).
- [ ] Optional: reviews with ratings, email notifications through BullMQ.

## Phase 8 — Deployment and presentation

- [ ] Web on Vercel; API + Postgres + Redis on Railway or Fly.io. `API_ORIGIN` is a runtime variable of the frontend server, so a changed API address is a redeploy without a rebuild; `TRUST_PROXY` on the API has to reach past the extra `X-Forwarded-For` entry the frontend server's own request produces.
- [ ] The README as a pitch: screenshots, an architecture diagram, an "interesting decisions" section (concurrency, webhooks, refresh-token rotation), a three-command start, Stripe test cards, demo logins for all three roles.
- [ ] The demo scenario: two browser windows book the same slot at once — one goes to payment, the other receives a polite conflict.

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
  rollback, a poll for a webhook — and phase 5 is what brings the first of those.
- The order of the phases follows the dependencies: database → auth → roles → concurrency → Stripe → catalogue → polish → deployment. Phase 6 can run in parallel with 4–5.

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
