# apps/api — NestJS

## Stack

NestJS 11 on Express, TypeScript, Jest + Supertest. CommonJS (unlike `apps/web`) — built by `nest build` into `dist/`. Storage is PostgreSQL (docker-compose in the root) through Prisma 7. Redis (also in docker-compose) backs one BullMQ queue — `booking-expiry`, which carries two jobs: the delayed one that releases an unpaid booking hold and the repeatable sweep behind it; `@nestjs/bullmq` is pinned to `11.x` because `12` is ESM-only and `nest build` / Jest here are CommonJS, and `ioredis` is a direct dependency because `bullmq` 6 no longer bundles it.

The configuration is shared with the rest of the repository: `tsconfig.json` extends `@repo/typescript-config/nest.json`, `eslint.config.mjs` extends `@repo/eslint-config/nest-js`. Only `outDir` is declared locally. The stock Nest CLI settings (`noImplicitAny: false`, a disabled `no-explicit-any`, its own `.prettierrc`) were removed deliberately — do not bring them back when updating Nest or generating new files.

## Layout

Nest's modular organization: every domain area gets its own folder with `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `dto/` and `entities/` when needed.

```
prisma/
  schema.prisma          # models; the client is generated into src/generated/prisma
  migrations/            # committed; created by pnpm --filter @repo/api db:migrate
  seed.ts                # demo data: pnpm --filter @repo/api db:seed
prisma.config.ts         # Prisma 7 config: loads the root .env, declares the seed command
src/
  app.module.ts          # root module: feature modules + the global ZodValidationPipe and JwtAuthGuard
  generated/prisma/      # the generated client — gitignored, never edit it
  common/dto/            # ApiErrorDto — the error body, for the Swagger error responses
  prisma/                # PrismaModule + PrismaService (extends PrismaClient)
    prisma.errors.ts     # isPrismaError, violatedConstraint — driver failures, read once
  auth/                  # registration, login, the JWT pair and its rotation
    auth.config.ts       # secrets, lifetimes and cookie attributes out of the environment
    auth.controller.ts
    auth.service.ts      # passwords and the rotation rules; sees no Prisma
    user.repository.ts   # users; translates the unique violation into an error of its own
    refresh-token.repository.ts  # refresh rows, the rotation transaction and the sweep
    token.service.ts     # signs and hashes tokens; touches no database
    jwt.strategy.ts      # passport-jwt, the token is read from the cookie
    cookies.ts           # cookie names, attributes and a reader for them
    ownership.ts         # the half of authorization a guard cannot answer
    guards/              # JwtAuthGuard, RolesGuard — both global in app.module.ts
    decorators/          # @Public(), @Roles(), @CurrentUser(), @RefreshToken()
  listing/               # the reference for new domain areas: CRUD plus ownership
    listing.module.ts
    listing.controller.ts
    listing.service.ts       # who may edit and delete a row; sees no Prisma
    listing.repository.ts    # the queries, the catalogue page, the FK violation
    listing.service.spec.ts
    catalogue-cursor.ts      # the keyset cursor of GET /listings, encoded and parsed
    catalogue-cursor.spec.ts
    dto/listing.dto.ts   # createZodDto on top of the @repo/contracts schemas
  booking/               # rules over rows; phases 4-6 give it a domain of its own
    booking.module.ts
    booking.controller.ts
    booking.service.ts     # who may read and cancel what; sees no Prisma
    booking.repository.ts  # the queries, the date mapping, the FK violation
    booking.service.spec.ts
    dto/booking.dto.ts
```

## Prisma

- Prisma 7 does not read `.env` on its own — `prisma.config.ts` loads the root `.env` through `process.loadEnvFile`; run the CLI only through the `db:*` scripts of `apps/api` (`pnpm --filter @repo/api db:migrate` and so on).
- The client is generated into `src/generated/prisma` (`prisma generate`, which also runs in `postinstall`); the directory is gitignored and in the ESLint ignores. The generator sets `importFileExtension = ""` — otherwise ts-node does not resolve the `.js` imports in the seed.
- Database access goes through `PrismaService` only (injected; `PrismaModule` is imported by the feature module). Do not create `new PrismaClient` inside services.
- **Every entity gets a repository.** The queries never sit in a service: they move one step further out, into a `*.repository.ts` next to it — `auth/`, `listing/` and `booking/` all have one, and a new domain area comes with one in the same change. The repository owns the query, the transaction and the mapping of rows onto the contract types, and it translates driver-specific failures (a `P2002` becomes `EmailAlreadyRegisteredError`) so that no Prisma symbol reaches the service. Three helpers in `src/prisma/prisma.errors.ts` are what it translates through: `isPrismaError(error, code)` narrows the error, `violatedConstraint(error, leaf)` reads which constraint gave way, and `isExclusionViolation(error)` recognises the `EXCLUDE` constraint of phase 4. The second exists because Prisma 7 talks to Postgres through a driver adapter, which leaves `meta.target` and `meta.field_name` unset and reports what it knows under one nested path instead — that path is written down once there, and a repository only describes the leaf it expects (`{ fields }` for a unique conflict, `{ index }` for a foreign key). The third reads the same nested path for the raw SQLSTATE (`23P01`) rather than a Prisma code, which is generic for an exclusion violation and could move between versions. The service keeps the rules and the HTTP exceptions. The direction holds both ways: a type both layers need (`IssuedRefreshToken`) lives in `auth.types.ts`, so the repository never imports from a service. A repository is a plain `@Injectable()` class injected by its own type — not an interface behind a token: a second implementation of "Postgres" is never coming, and the seam that does need one is an external service (Stripe), not the database.
- The rule holds even where the module is plain CRUD, and `listing` is that case: the two files buy a service that can be unit-tested against a fake instead of a query builder, one place for `P2025` to become a `null` the service reads as a lost race, one place for the `deleted_at` of the soft delete below, and no second decision to take the day the module grows a rule. `booking` shows what that day looks like — it owns rules about who may read and cancel a row, and phase 4 added the locking transaction (`SELECT ... FOR UPDATE`, the lazy hold sweep, the `EXCLUDE` backstop) to the repository that was already there. What a repository does not get is an interface behind a token, see the line above: the split is between the rules and the queries, not between two implementations of Postgres.
- The check-in/check-out columns are `@db.Date`, while dates are exposed as `YYYY-MM-DD` strings (the mapper in `BookingService`); the contract did not change when the storage did.
- Money is the currency itself, exact to the cent: `listings.price_per_night` is `numeric(10, 2)` and never a float, because a float stores neither 120.10 nor the sum of a stay's nights exactly and the error accumulates across the nights. The contract refuses anything finer than a cent (`MONEY` in `packages/contracts/src/listing.ts`), so the column can never round a price the API accepted, and the repository is the one place a `Decimal` row becomes the `number` the contract speaks. A payment that wants minor units multiplies at its own edge rather than making every screen divide.
- A booking references a listing with `onDelete: Restrict` and a guest with `onDelete: Cascade`, and a listing references its owner with `onDelete: Restrict` as well. The restrict is deliberate — a listing somebody has booked is not something the database will let go of, because that would take their stay down with it — and it has to hold one level up too: a cascade from `users` would have to delete listings that bookings restrict, so it would promise an account deletion the database refuses to perform. Removing an owner therefore lets go of the listings first, which is the delete order everywhere rows are wiped anyway: bookings, then listings, then users (`test/database.ts`, `prisma/seed.ts`). A guest is the case that does cascade — their bookings are theirs to take with them.
- **`DELETE /listings/:id` retires the listing, it does not remove the row** (`deleted_at`). The constraint above is why: a booking names where the stay was, so the row has to outlive the offer, and refusing the delete outright reached an owner as a `409` that anyone with one finished stay in their history could never get past. Retired means out of the catalogue, off its owner's dashboard, `404` on the way back, and closed to new bookings — the stays already taken against it keep their record.
- **`ListingRepository` owns what "still offered" means**, and that is what makes the soft delete affordable: the condition is written once as the exported `STILL_OFFERED`, every read of the class is already narrowed by it, and a call site cannot forget a filter it has no way to spell. `deletedAt: null` is not spelled anywhere else — the queries over `listings` that live outside the class both sit in `BookingRepository`, and each says which of the two it is: `findByIdWithListingOwner` deliberately does not narrow at all, because it resolves the listing of a stay whether or not it is retired and the stay is what the row was kept for, while phase 4's `create` reads `deleted_at` itself under the `FOR UPDATE` lock — the one place the check has to be atomic. A new query over that table has to answer the same question.
- **The catalogue is a keyset page, and the ordering, the cursor and the index are one decision.** `GET /listings` orders by the pair `ORDER_BY` in `listing.repository.ts` names, `catalogue-cursor.ts` encodes that pair into the opaque `nextCursor`, and a raw-SQL migration indexes exactly it, partial on `deleted_at IS NULL` — Prisma can spell neither the `WHERE` nor the sort direction, the same reason the `EXCLUDE` constraint is hand-written. Changing one of the three means changing all three. The comparison against the cursor is written out as a `where` rather than handed to Prisma's own `cursor` option, because that one resolves the row by id first and a listing retired between two pages would end the catalogue early; `limit + 1` rows are read so `nextCursor` can be issued without a second `count`. A cursor this API did not issue is a `400` — the value comes from a URL, so it is parsed as untrusted input, and a silent first page would answer a question nobody asked.
- **The ordering is the client's, out of a closed set** (`sort` in `listingQuerySchema`: `newest`, `oldest`, `priceAsc`, `priceDesc`). Four values rather than a field plus a direction, because the two are not independent: **the tiebreaker follows the direction of the key**, so `price ASC, id ASC` and `price DESC, id DESC` are exact reverses and one btree read both ways answers both — two columns disagreeing about direction would need an index apiece. That is why there are two indexes and not four, and why `oldest` needed no migration of its own. The switches in `catalogue-cursor.ts` and `afterCursor` are exhaustive, so a fifth sort stops compiling in every place that has to know about it — `ORDER_BY`, the cursor, and the migration it needs.
- **A cursor names a place in one ordering and in no other**, so it carries the `sort` it was issued under and `ListingService.readCursor` refuses it against another with a `400` of its own words. Reading it under a different sort would compare a price against a timestamp, and the rows after it would be a page of neither list; changing what the catalogue is ordered by starts the pages again, which is what dropping the cursor does.
- **The cursor's `where` says the key twice, and the redundant half is the one the index uses.** `key > X OR (key = X AND id > Y)` is the whole truth about where a page starts, but Postgres reads no start position out of an `OR`: it takes the index for the `ORDER BY`, walks it from the top and discards everything before the cursor with a filter, so a page deep in the catalogue costs what an offset costs — the one thing a keyset page exists not to do. `afterCursor` therefore emits `key >= X` beside the `OR`, implied by it as a condition and decisive as an index condition; a row comparison `(key, id) > (X, Y)` would say both at once, and Prisma cannot spell one. That bound is also why the result is `AND`-ed into the query rather than spread into it: on a price-ordered page it narrows the same column `minPrice`/`maxPrice` narrow, and a merge would let the later key replace the earlier one and drop the filter from every page after the first.
- **A `where` may cross between two repositories; a row mapping may not.** The catalogue's date filter asks for listings against which no stay both holds its slot and overlaps the window, and it imports `holdsTheSlot` and `overlapping` from `BookingRepository` rather than restating them — that way the catalogue and the transaction that refuses a booking cannot disagree about what "taken" means, and `holdsTheSlot` is written as the complement of `lapsedHolds` so those two cannot drift either. What does not cross is anything that turns a row into a contract type: the availability of one listing is a read over `bookings`, so it lives in `BookingRepository.findActiveRanges` and `ListingService` is given that repository, instead of a second place learning that dates are `@db.Date`.
- **A booking carries a summary of the listing it names** (`listingSummarySchema` — the title and the nightly price), and that read is deliberately not narrowed by `deleted_at`. It is the only thing on the API surface that resolves a retired listing: the row is kept so a stay can go on naming where it was, while `GET /listings/:id` answers `404` for it to everybody — that read is public and cached by URL on the frontend, so personalising it for whoever holds a stay is not available and would not be right. `toBooking` copies the two fields by name rather than spreading the row, because `findByIdWithListingOwner` selects the owner beside them for the authorization rules and it has no business in a response body.
- **The catalogue's three reading routes are `@Public()`** — the list, one listing and its availability. A catalogue nobody may see before signing up is not a catalogue, and the frontend caches those answers in a store keyed by URL and shared between visitors, so a read that needed a session could not be cached at all. Everything that writes to the catalogue stays behind the guard, and `GET /listings/mine` stays behind `@Roles(Role.OWNER)`: it is scoped to the caller, which is the opposite of public.
- **The trade is a guarantee the database no longer makes.** The row is still there, so the foreign key can no longer refuse a booking against a retired listing. Phase 4 closed that with the transaction in `BookingRepository.create`: it locks the listing row with `SELECT ... FOR UPDATE`, reads `deleted_at` under that lock, expires this listing's lapsed holds, refuses an overlap with an active stay, and inserts the hold — with the `EXCLUDE` constraint (below) as the backstop.
- The column stays out of `@repo/contracts`: retiring is how the storage answers "gone", and the API surface says it the ordinary way — absent from the lists, `404` by id.
- **`bookings.status` (`PENDING_PAYMENT | CONFIRMED | CANCELLED | EXPIRED`) and `expires_at`** are phase 4's. A booking is created a `PENDING_PAYMENT` hold with `expires_at = now + 15 min`; only `PENDING_PAYMENT` and `CONFIRMED` are "active" — the set `ACTIVE_STATUSES` in `booking/domain/booking-status.ts`, which the overlap check narrows to and the `EXCLUDE` constraint filters on. `DELETE /bookings/:id` moves the row to `CANCELLED` rather than deleting it (phase 6 refunds against the record). `booking/domain/` holds the status set, the legal transitions and the date-range rules as pure functions — no Nest, no Prisma.
- **"Active" is a rule about the slot, not about who may read a row.** The reads of `BookingRepository` are not narrowed by status: a cancelled or expired stay keeps answering the people who could always read it, with `status` saying which of the four it is. That is what puts the field on the contract in the first place — narrowing the reads as well would leave two of its four values unobservable through the API, and a guest whose hold lapsed would be told their booking never existed. What stays narrowed is every rule about the slot: the overlap check inside `create`, and the `where` of `cancel`, which is why cancelling twice is still a `404`. `expires_at` is not cleared when a booking leaves `PENDING_PAYMENT` either — when a hold stopped holding is what a refund asks about, and `status` already says that it did.
- **Hold expiry is three writes of one condition, and `lapsedHolds(now)` in `booking.repository.ts` is that condition** — `PENDING_PAYMENT` with a deadline at or before now, written once so the boundary cannot drift between the three callers.
- **`bookings_no_overlap` is an `EXCLUDE` constraint** (`btree_gist`, `daterange(from, to, '[)')`, `WHERE status IN ('PENDING_PAYMENT','CONFIRMED')`) — the last line of defence against a double booking, applied by a hand-written raw-SQL migration because Prisma cannot express it. The half-open range keeps back-to-back stays legal, matching the strict inequalities of the in-transaction overlap check. It surfaces as SQLSTATE `23P01`, read by `isExclusionViolation`.
- **Hold expiry has three halves, and the third one is why the other two may fail.** `BookingExpiryQueue.scheduleExpiry` puts a job in Redis for `expires_at` and `BookingExpiryProcessor` runs `BookingRepository.expireHold` on it — that is the precise release. The `updateMany` at the top of `create`'s transaction is the lazy one, and it only ever looks at the listing being booked. Behind both is a **repeatable sweep**: a job scheduler (`SWEEP_INTERVAL_MS`, one minute) whose job runs `expireLapsedHolds` over every listing. It is not redundancy for its own sake — the queue has no volume under it, so a Redis restart drops every scheduled job, and without the sweep a hold on a listing nobody books again would keep its slot forever. That is also what lets `scheduleExpiry` and `cancelExpiry` swallow their failures: by the time either runs the booking is committed, so raising would answer an existing booking with a `500`, and the worst a lost job costs is up to a minute of delay. Redis (`REDIS_URL`, no fallback) is a service in docker-compose, pinned to `maxmemory-policy noeviction` because BullMQ requires it.
- A model change means a migration (`db:migrate`), and the migration files are committed.
- `db:migrate` is `prisma migrate dev` and belongs to a developer machine only — it can decide to reset the database. A deployed environment runs `db:deploy` (`prisma migrate deploy`), which only applies what is already committed; that is what `railway.json` hangs on `preDeployCommand`.
- Prisma 7 dropped the automatic steps of v6: neither `migrate dev` nor `migrate reset` runs the seed script, and `migrate dev` no longer regenerates the client. So a schema change is `db:migrate` + `db:generate`, and a recreated database is `db:migrate` + `db:seed`.

Generate scaffolding through the Nest CLI rather than by hand:

```sh
pnpm --filter @repo/api exec nest g module booking
pnpm --filter @repo/api exec nest g controller booking
pnpm --filter @repo/api exec nest g service booking
```

## Code rules

- Dependencies come through constructor injection (`constructor(private readonly bookingService: BookingService)`). No manual `new` for providers.
- **An injected name is its type in camelCase** — `bookingService`, `prismaService`, `jwtService`, `userRepository`, `refreshTokenRepository`, `authConfig`. Not a shortening (`svc`, `prisma`, `jwt`, `config`) and not the collection a repository stands for (`users`, `refreshTokens`): at the call site the suffix is what says which layer is being addressed, and `this.refreshTokenRepository.rotate(...)` next to `this.tokenService.issuePair(...)` needs no second look to tell storage from signing. The rule covers injected constructor parameters that are not fields (`JwtStrategy`) and the doubles that stand in for them in a spec, so one collaborator reads the same everywhere.
- The controller stays thin: parse the request, call the service, return the result. Business logic lives in services.
- Input is validated by the `@repo/contracts` schemas through `nestjs-zod`. The schema is written in the contracts package, and only a DTO wrapper stays in `apps/api`:

```ts
// apps/api/src/booking/dto/booking.dto.ts
export class CreateBookingDto extends createZodDto(createBookingSchema) {}
```

The class is needed because Nest takes the metatype of the parameter from the runtime — an interface does not work here. The global `ZodValidationPipe` is already wired through `APP_PIPE` in `app.module.ts`, so per-route `@UsePipes` are unnecessary.

- A response never uses a DTO class as its TypeScript type — the controller keeps returning the contract type (`Promise<Booking>`, `Promise<Listing[]>`), because a return type is erased at compile time and documents nothing to Swagger. Where a response is worth documenting in `/docs`, the same `createZodDto` wrapper exists in the module's `dto/*.dto.ts` (`BookingDto`, `ListingDto`, `UserDto`) purely to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`/`@ApiOkResponse({ isArray: true })`; the error body a service can throw (404/409/…) is documented the same way against `ApiErrorDto` (`src/common/dto/api-error.dto.ts`, wrapping `apiErrorSchema`). `@Roles()` already carries its own `ApiForbiddenResponse` — a route only adds the exceptions its own service throws. The exception is a route whose service throws `403` as well: a guard refusing the role and a service refusing the row are one status with two reasons. Nest joins the descriptions of the two decorators rather than letting one replace the other, so the handler adds only the reason `@Roles` does not know about (`NOT_YOUR_LISTING` in `listing.controller.ts`) — repeating the role there would read back doubled. Decorators apply bottom-up and a reordering would drop a half silently, which is why `test/openapi.e2e-spec.ts` asserts that both survive.
- Do not use `class-validator` and `class-transformer`: their decorators are not reused by the frontend, and the contract drifts apart.
- Format rules and relations between fields (including cross-field ones, such as "check-out after check-in" and "check-in not in the past") live in the contract schema. What stays in the service is what requires state: checks against other bookings, permissions, the database.
- A rule that reads the clock makes the schema time-dependent, and the fixtures with it: `createBookingSchema` refuses a check-in before today in UTC, so every date an e2e spec or the seed books is derived from the day it runs (`test/dates.ts`, `inDays` in `prisma/seed.ts`) rather than written down. A literal date in a fixture passes until it arrives and fails every run after.
- Errors go through the built-in Nest exceptions (`NotFoundException`, `BadRequestException`), not through a manual `res.status(...)`.

## Authentication

Written by hand, not taken from Auth.js: passwords through argon2, a JWT pair in httpOnly
cookies, refresh tokens rotated with reuse detection.

- **The guard is global.** `APP_GUARD` in `app.module.ts` closes every route; `@Public()`
  is what opens one (`/`, `/auth/register`, `/auth/login`, `/auth/refresh`,
  `/auth/logout`). A new endpoint is therefore protected by default — the opposite order
  leaks data the first time a decorator is forgotten. `@Public()` also drops the OpenAPI
  security requirement `main.ts` declares document-wide, so `/docs` cannot disagree with
  the guard; that is why it is a composed decorator rather than a bare `SetMetadata`.
- **`ThrottlerGuard` is registered first**, ahead of `JwtAuthGuard` — guards run in
  registration order, and the limiter has to answer `429` before argon2 spends 64 MB on a
  password nobody asked it to check. 120 requests a minute per address API-wide, 10 on
  `/auth/register` and `/auth/login` (`@Throttle` on the handlers). The bucket key is
  `req.ip`, which is only the real client when `TRUST_PROXY` names how many
  `X-Forwarded-For` entries to believe — `main.ts` turns it into Express's `trust proxy`.
- **A route overrides that ceiling in whichever direction its own traffic needs**, and the
  three `@Public()` reads of the catalogue are the case for widening it (`CATALOGUE_READS`
  in `listing.controller.ts`, 600 a minute). They are the only reads the frontend caches,
  and a cached read is served from that server rather than from a browser: it arrives here
  from one address with no `X-Forwarded-For` to bucket it by, so the default would be a
  ceiling on the whole site's cache misses rather than on one client. Forwarding the header
  is not the fix either — it would go into the Data Cache key and split the entry the cache
  exists to share. What still bounds the route is the contract: `limit` caps a page at 50
  rows and the availability window at a year. A route that stops being public stops needing
  the override, because a session buckets it by visitor again.
- **The tokens live in cookies only** and never appear in a response body. `access_token`
  is scoped to `/`, `refresh_token` to `/auth`, so a request to `/bookings` does not carry
  the credential that can mint new sessions. The attributes are assembled once in
  `auth.config.ts` and `res.clearCookie` has to repeat them, or the browser keeps the cookie.
- **Rotation.** Every `/auth/refresh` burns the token it was given and issues the next one
  in the same family. Only the SHA-256 of a token is stored (`refresh_tokens.token_hash`):
  it has to be looked up by equality, which a salted password hash cannot be. A token that
  comes back after it was already burned means a copy exists somewhere — the whole family
  is revoked and both sides have to log in again. Burning the old row and writing its
  successor is one transaction inside `RefreshTokenRepository.rotate`; a `false` from it is
  the lost race of two parallel refreshes, which fails that one request and spares the
  family. A failed refresh clears the cookies as well, or the client keeps retrying a
  credential that can never work again.
- **Spent rows are kept until they expire, then deleted.**
  `RefreshTokenRepository.deleteExpired` runs on login and after each rotation, scoped to
  one user and driven by `@@index([userId, expiresAt])`. It deletes by `expiresAt` only: a
  revoked row still has to be there to recognise a replay, which is the whole point of
  keeping it. It runs through `AuthService.sweepExpired`, which logs a failure instead of
  raising it: the session is already stored by then, and after a rotation the presented
  token is already burned — failing the request would lose a session the database considers
  open. Whatever the sweep missed goes at the next login or rotation of the same user.
- **Configuration comes from the environment** through `loadAuthConfig()`, provided under
  the `AUTH_CONFIG` token. There is no fallback secret: a missing `JWT_ACCESS_SECRET` stops
  the process at boot rather than shipping a key everyone knows.
- `JwtStrategy` reads no database — that is what a short-lived access token buys, and the
  price is that a role change only takes effect at the next refresh. Anything that needs
  the current row (like `/auth/me`) reads it explicitly.
- Passwords are hashed with **argon2id**; the answer to a wrong password and to an unknown
  address is the same, so the login form is not a list of registered users. It has to take
  the same time too — an unknown address is verified against a throwaway hash instead of
  returning early, because a 2 ms answer where a real one takes 30 ms says the same thing
  a different message would.
- `/auth/me` answers **401**, not 404, when the token is valid but its row is gone: that is
  an ended session rather than a missing resource.
- The password and email rules live in `registerSchema` / `loginSchema` in
  `@repo/contracts`, like every other contract rule. `login` deliberately does not reuse
  the password rules of `register`: an old password that no longer passes the policy still
  has to get its owner in.

## Authorization

Two checks, and the split between them is the point.

- **The role check is a guard.** `RolesGuard` is registered through `APP_GUARD` right after
  `JwtAuthGuard` — guards run in registration order, and this one reads the user that one
  put on the request. It answers "may this kind of user call this endpoint at all" from the
  access token alone: no query, no row, nothing the handler would have to repeat.
- **`@Roles()` is opt-in**, unlike `@Public()`. A route with no decorator is open to every
  signed-in role, because "is there a session" has one right default and "which roles" does
  not — a guessed one would either lock out or let through. At least one role has to be
  named; `@Roles()` would read like a restriction and be none.
- **Membership of a set, not a hierarchy.** ADMIN does not pass an `@Roles(Role.OWNER)`
  check by being senior to an owner. A route admins may use names `ADMIN` itself, so what a
  role can reach is readable where the route is written — and `@Roles(Role.USER)` on
  "create a booking" keeps meaning what it says instead of quietly admitting the two roles
  above it.
- **The ownership check is not a guard**, and `src/auth/ownership.ts` says why: a role is a
  claim of the token and is known before the handler runs, while ownership is a property of
  a row and cannot be known until the row is read. A guard that decided it would fetch the
  row the handler is about to fetch anyway. So it lives in the service, next to the read.
  A `403` from the guard means "not your kind of endpoint", a `403` from the service means
  "not your row". `ownsOrIsAdmin` is where the one real hierarchy lives — an admin passes
  without owning anything, and that is a rule about rows rather than about endpoints.
- **A scope is neither of the two.** What `GET /bookings` returns depends on the role, and
  that goes into the `where` of the query (`scopeFor` in `BookingService`), not into a
  filter the client may pass: a query that cannot return a forbidden row needs no check
  after it. The switch over the role is exhaustive on purpose — a fourth role stops
  compiling there instead of falling through to a scope somebody has to guess at — and it
  picks one of three named queries on `BookingRepository` rather than assembling a `where`,
  so an unhandled role reaches no query at all instead of an unscoped one. Its `default`
  assigns the role to `never` and throws, because the type is not the whole guarantee: the
  role arrives in a signed access token that `JwtStrategy` does not parse against the
  contract, so one minted before a role was renamed still carries the old name for as long
  as `JWT_ACCESS_TTL`.
- **Reading and writing are separate rules over the same row.** An owner reads the bookings
  against their listing and cannot cancel one; that is why `BookingService.remove` does not
  reuse the check in `findOne`.
- **403 or 404 depends on whether the caller could have found the row anyway.** A listing
  refused to another owner answers `403`: the catalogue is readable by every signed-in
  user, so "exists, but not yours" tells them what `GET /listings` told them a moment
  earlier. A booking is the other case — nothing lets a stranger list bookings, so a `403`
  would be the one way to learn that an id exists at all, and `getReadable` answers
  `404` for a row the caller may not read. The `403` on cancelling stays: it goes to
  someone who may already read the booking (the owner of the listing), and denies them the
  second right rather than the first.
- **Roles come from the database, never from a request.** `/auth/register` always writes a
  `USER`. `JwtStrategy` reads no database, so a promoted user carries the old role until
  the next refresh — the e2e helper `signInAs` logs in again after promoting the row for
  exactly that reason.

## main.ts

`src/main.ts` is already set up and driven by environment variables:

- `assertConnectionUrlsMatchCompose()` before anything else, and before `NestFactory.create` on purpose: creating the module connects Prisma, so a `DATABASE_URL` that stopped agreeing with `POSTGRES_*` would be reported as a refused connection rather than as the two lines of `.env` that drifted apart. `src/common/env-consistency.ts` holds the rule — see "Environment" below;
- listens on `API_PORT ?? PORT ?? 3001` at `API_HOST ?? '0.0.0.0'`;
- CORS: the list of origins from `WEB_ORIGIN` (comma-separated), `credentials: true`;
- `trust proxy` from `TRUST_PROXY`. Express counts `X-Forwarded-For` from the right, so the value is the number of proxies that **append** to it, not the number of hops a request makes — the frontend's BFF forwards the header untouched and is therefore not one of them, while the proxy in front of this service is (it appends the frontend server's address). 0 means believe nothing and use the socket address. It is what makes `req.ip` — and with it the rate limiter's bucket — the client rather than the proxy. Never set above the truth: one entry too many and `req.ip` becomes a header the client writes rather than an address.
- Swagger at `/docs`: the document is built from the same zod schemas, and `cleanupOpenApiDoc` is mandatory (in `nestjs-zod` 5 it replaced `patchNestJsSwagger`). It is published only when `NODE_ENV !== "production"` — the document describes the whole API surface. `addCookieAuth(ACCESS_TOKEN_COOKIE)` declares the session and `addSecurityRequirements` applies it to every operation, matching the global guard; `@Public()` is what drops it again. The credential is a cookie, so "Try it out" works from a browser that logged in through `/auth/login` and not from a pasted bearer header.

Do not hardcode the port, the host or an origin. A new frontend origin goes into `.env`, not into the code.

## Environment

The connection URLs repeat what docker-compose.yml is given, and nothing links the two — Compose cannot assemble a URL from parts, so `POSTGRES_USER/PASSWORD/DB/PORT` and `REDIS_PORT` describe the containers while `DATABASE_URL` and `REDIS_URL` describe how the application reaches them. `assertConnectionUrlsMatchCompose()` compares the pair at boot instead of leaving the drift to surface as a refused connection fifteen minutes later.

- **It checks the local setup, not the deployment.** A platform hands over a ready URL — a pooler host, `sslmode=require` — and sets no `POSTGRES_*` at all, so an absent part is not an error but the signal that there is nothing to compare against. Every branch of the check is written to be silent in that case, which is also why a URL the WHATWG parser refuses is only reported where the parts are there: a multi-host connection string is legitimate and none of this function's business.
- **The host is deliberately not compared** — Compose is never told one, so there is no second side to disagree with.
- **An omitted port reads as the well-known one** (5432, 6379), because that is exactly what Compose publishes when `POSTGRES_PORT` is unset: the two agree rather than differ.
- **A URL with no host is named once, not unpacked.** `localhost:5432` parses rather than throws — `localhost` becomes the scheme — and comparing its empty fields would turn one typo into a list of invented mismatches. A unix socket has no host either, and is recognised by the `host` query parameter libpq spells it with and left alone.
- What it does not answer is whether the URL reaches anything: a stopped container, or a volume still holding the credentials it was first initialised with, is what the connection itself reports. Changing `POSTGRES_*` still needs `docker compose down -v`.
- A new variable that appears on both sides of that split belongs in the same check, next to the ones already there.

## Tests

- Unit: `*.spec.ts` next to the code, `rootDir: src`, run with `pnpm test` from the root. No database needed: a service is given fakes of its repositories and a repository spec mocks `PrismaService` (`{ provide: PrismaService, useValue: ... }`), so what a unit test checks is the logic around the queries rather than the queries. The script is a bare `jest` on purpose — see the note on `--experimental-vm-modules` below.
- E2E: `test/*.e2e-spec.ts`, config `test/jest-e2e.json`, run with `pnpm test:e2e` from the root. They hit the real database **and Redis** from docker-compose (it needs `docker compose up -d` and applied migrations) and reset both in `beforeEach` — `resetDatabase` wipes the tables, `resetQueue` (`test/queue.ts`) obliterates the `booking-expiry` queue. The script loads the root `.env` and enables `--experimental-vm-modules` — do not remove it. `maxWorkers: 1` in the same config is not optional either: the spec files share one database, and in parallel workers one file's cleanup wipes rows another one is working with. `booking.concurrency.e2e-spec.ts` is phase 4's proof — ten parallel identical `POST /bookings`, exactly one `201`. `booking-expiry.e2e-spec.ts` is the other half of that phase and the one thing no request can provoke: a hold is released fifteen minutes later by a job, so the spec drives the queue directly, pushes a deadline into the past and waits for the worker `app.init()` started.
- `--experimental-vm-modules` is needed by the tests that actually execute queries, not by every test that sees Prisma. Prisma 7 has no binary engine: with a driver adapter the generated client loads a WASM query compiler through `await import(...)` on `$connect()`, and Jest forbids a dynamic import inside its vm context without the flag. No unit test ever gets the real `PrismaService` — a service sees fakes of its repositories, a repository spec a mock — so its constructor never runs and `$connect()` never happens; hence no flag there. If a unit spec starts failing with `A dynamic import callback was invoked without --experimental-vm-modules`, it has reached the real database: mock Prisma, do not add the flag.
- Both test tasks are declared in `turbo.json` with `dependsOn: ["^build"]`, so run them from the root. The specs import `@repo/contracts` schemas as values and need the built `dist/`; a direct `pnpm --filter @repo/api test` skips the build and fails on a fresh clone.
- A new controller or service comes with a spec modelled on `src/booking/booking.service.spec.ts` (`Test.createTestingModule`).
- A service spec fakes the repositories instead of mocking Prisma — every module has them, so the only spec left holding a `PrismaService` mock is the one written for a repository itself (`src/auth/user.repository.spec.ts`): `src/auth/auth.service.spec.ts`, `src/listing/listing.service.spec.ts` and `src/booking/booking.service.spec.ts` run their service against in-memory stores and assert what ends up stored, so the test states the rule ("a replayed token revokes the family", "an owner may read the stay and not cancel it") rather than the call the service happens to make. The fakes are typed `PublicOf<Repository>` — a mapped type keeps only the public surface, so a fake needs no inheritance and still stops compiling when the real class gains or drops a method, or changes what one returns. An argument added to an existing method it does not catch: a shorter signature stays assignable to a longer one, and method parameters are compared bivariantly even under `strictFunctionTypes`. With the repository faked, the Prisma code paths of that module are covered by e2e alone; that is the trade, and it is why `test/auth.e2e-spec.ts` and `test/listing.e2e-spec.ts` have to keep exercising them. Where a query decides something HTTP cannot provoke on demand, the e2e spec takes the repository out of the container and calls it directly instead of going through the API. There are two: `test/refresh-token.repository.e2e-spec.ts`, because which of two parallel refreshes reads the row first is a matter of timing — reading it after the winner burned it is a replay, not the race the conditional update exists for; and `test/booking.repository.e2e-spec.ts`, because two adapter-specific error shapes decide something HTTP cannot provoke: the guest foreign key (a missing listing is now refused by the `FOR UPDATE` read, so only the guest key reaches the insert) read through `violatedConstraint`, and the `EXCLUDE` constraint violation (`23P01`) read through `isExclusionViolation` when two overlapping creates race past the in-transaction check. Both are the kind of parse that has to be executed against the real driver rather than trusted.
- In e2e, check the response with a schema from `@repo/contracts` (`bookingSchema.parse(response.body)`) — that way the test catches a drift from the contract, not only a status code.
- Every route except the `@Public()` ones is behind the global guard, so an e2e spec talks to the API through the agent from `test/session.ts` (`signIn(app)`) — a `request(app.getHttpServer())` without cookies only ever gets a 401. A rule that differs by role needs an agent per role: `signInAs(app, Role.OWNER)` registers, promotes the row and logs in again, because the token minted at registration still says `USER`.
- The cleanup is `resetDatabase(app)` from `test/database.ts` rather than a `deleteMany` in each spec. The order is the reason it lives in one place: bookings restrict the listings they point at, and deleting users first would cascade into listings the bookings still reference. Refresh tokens go with their user through `onDelete: Cascade`.

## Checks

```sh
pnpm --filter @repo/api lint          # eslint . --max-warnings 0
pnpm --filter @repo/api lint:fix      # eslint . --fix, Prettier formatting included
pnpm --filter @repo/api check-types   # tsc --noEmit
```

The lint is type-aware (`recommendedTypeChecked`), so it catches what plain ESLint misses: unhandled promises, unsafe operations on `any`. Fix the rules rather than disabling them. A floating promise at the top level (like `void bootstrap()` in `main.ts`) is marked with an explicit `void`, not ignored.
