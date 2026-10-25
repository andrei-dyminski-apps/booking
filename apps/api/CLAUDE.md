# apps/api — NestJS

## Stack

NestJS 11 on Express, TypeScript, Jest + Supertest. CommonJS (unlike `apps/web`) — built by `nest build` into `dist/`. Storage is PostgreSQL (docker-compose in the root) through Prisma 7. Redis (also in docker-compose) backs three BullMQ queues — `booking-expiry` (the delayed job that releases an unpaid hold, the repeatable sweep behind it, the withdrawal of a released hold's PaymentIntent, the refund a cancellation owes and a sweep of its own for the refunds still owed), `host-payout` (see "Host payouts") and `payment-event` (the webhook inbox's worker, its sweep and a daily prune, see "Payments"); the services schedule through ports (`BookingJobs`, `PaymentEventJobs`, `PayoutJobs`) and never name a queue, and every processor logs its failed jobs (`src/common/job-failure.ts`), which BullMQ otherwise keeps to itself; `@nestjs/bullmq` is pinned to `11.x` because `12` is ESM-only and `nest build` / Jest here are CommonJS, and `ioredis` is a direct dependency because `bullmq` 6 no longer bundles it. The same Redis carries the pub/sub behind the event stream (`RealtimeService`, two connections of its own). Payments go through Stripe (`stripe`, the Node SDK), behind the `PaymentGateway` port of the payment module — see "Payments" below.

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
  common/paging.ts       # Page<T>, the cursor envelope and the two refusals every keyset page shares
  common/throttle.ts     # CATALOGUE_READS — the widened limit of the public, cached reads
  common/dto/            # ApiErrorDto — the error body, for the Swagger error responses
  common/redis-url.ts    # requireRedisUrl — the queue and the pub/sub connect with it
  common/body-parsers.ts # Nest's parsers, the raw body kept for the signed webhooks only
  common/job-failure.ts  # describeJobFailure — the line every processor logs a failed job with
  common/iso-date.ts     # `@db.Date` onto `YYYY-MM-DD`, and today's midnight — the repositories map those columns, the services read today by it
  prisma/                # PrismaModule + PrismaService (extends PrismaClient)
    prisma.errors.ts     # isPrismaError, violatedConstraint — driver failures, read once
    escape-like.ts       # `%`, `_` and `\` of a `contains`, escaped — two repositories search by a part
  auth/                  # registration, login, the JWT pair and its rotation
    auth.config.ts       # secrets, lifetimes and cookie attributes out of the environment
    auth.controller.ts
    auth.service.ts      # passwords and the rotation rules; sees no Prisma
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
    listing-pricing.ts       # the price rows onto the contract; the hold's quote reads them through it
    listing.service.spec.ts
    catalogue-cursor.ts      # the keyset cursor of GET /listings, encoded and parsed
    catalogue-cursor.spec.ts
    dto/listing.dto.ts   # createZodDto on top of the @repo/contracts schemas
  user/                  # accounts: the repository that maps users, and the admin's routes
    user.module.ts       # exports UserRepository — AuthModule imports it
    user.controller.ts   # GET /users, GET and PATCH /users/:id — @Roles(Role.ADMIN) on the class
    user.service.ts      # what the guard cannot answer: not one's own account, and a caller still an admin
    user.repository.ts   # users; the unique violation, the page, the role and the block
    user.service.spec.ts
    user-cursor.ts       # the keyset cursor of GET /users
    user-cursor.spec.ts
    dto/user.dto.ts
  lookup/                # GET /lookups/*: what an id filter box suggests, by name or by a whole id
    lookup.controller.ts # one route per box, each open to the roles whose filter it fills in
    lookup.service.ts    # the scope by role, the switch exhaustive like BookingService's
    lookup.repository.ts # the scopes, and both searches: accounts by name (and address, for an admin), listings by title
    lookup-page.ts       # the search, the whole id and the keyset every lookup shares
    lookup-cursor.ts     # keyset over (name, id); the name base64url-encoded inside the envelope
    lookup.service.spec.ts
    lookup-cursor.spec.ts
    dto/lookup.dto.ts
  conversation/          # guest ↔ host threads: one per guest and listing, the host read through the listing
    conversation.controller.ts   # @Roles(USER) per route; an admin is a side of no thread
    conversation.service.ts      # which side the caller is, or a 404; the scope by account, admin refused
    conversation.repository.ts   # threads and messages as one entity; the locked append, the read markers
    conversation-cursor.ts       # both keysets: threads by last_message_at, messages by created_at
    conversation.service.spec.ts
    conversation-cursor.spec.ts
    dto/conversation.dto.ts
  # booking, payment and payout are the modules split into domain/, application/,
  # infrastructure/ and presentation/ — see "Payments". The dependencies run one way:
  # payment <- booking <- payout (payout also uses payment). Neither payment nor booking
  # imports the module that follows it; payout plugs in through two registries.
  booking/               # the stays: the hold, the cancellation, the expiry
    booking.module.ts      # imports PaymentModule; exports BookingRepository and StayLifecycle
    domain/                # pure functions: statuses and transitions, the date range, quoteStay
      booking.types.ts     # the shapes the layers share: a stay with its owner, a released hold, a refund target, the cursor
      booking.errors.ts    # what the repository throws instead of a Prisma code; the service turns them into HTTP
    application/
      booking.service.ts   # HTTP and the jobs meet here; sees neither Prisma, Stripe nor BullMQ
      ports/booking-jobs.ts  # BookingJobs — the release, withdrawal and refund jobs, as the service asks for them
      booking.service.spec.ts  # against fakes of the repositories, the gateway and a stay listener
      booking-payment.handler.ts  # succeeded: confirms the hold, or refunds a late payment; refunded: records it, cancels a stay not yet begun refunded in full; a lost dispute: cancels a stay not yet begun
      booking-payment.handler.spec.ts  # the provider's news, in the same module as the service
      testing/booking.fakes.ts  # the fixtures, fakes and module both specs share; out of the build (`*.fakes.ts`)
      stay-lifecycle.ts    # confirmed / refunded, announced to whoever follows the stays (payout)
      booking-cursor.ts    # the keyset cursor of GET /bookings, encoded and parsed
    infrastructure/
      booking.repository.ts      # the queries, the locking transaction, the quote under the lock
      booking-lease.ts           # whileLeased: the per-booking leases, on the database's clock, renewed while held
      stay-rows.ts               # a stay's money and its two people off a row — BookingRepository and PayoutRepository both map through it
      refund-failure.repository.ts  # refund_failures: the refunds a guest's bank sent back
      booking-expiry.queue.ts    # BullMQ, behind BookingJobs: the per-hold job, the two sweeps
      booking-expiry.processor.ts
    presentation/
      booking.controller.ts      # /bookings, POST /bookings/:id/payment
      dto/booking.dto.ts
  payment/               # the guest's half of the money and the provider's front door; knows no stay
    payment.module.ts      # wires the port to its adapter: PaymentGateway → StripePaymentGateway
    domain/currency.ts     # CURRENCY, the one currency of the site
    domain/money.ts        # toCents, roundCents — the one conversion into cents, keys and charges alike
    application/
      ports/payment-gateway.ts  # PaymentGateway (abstract class = DI token), PaymentEvent
      ports/payment-event-jobs.ts  # PaymentEventJobs — how the inbox hands an event to its worker
      payment-event-handler.ts  # what a domain registers to act on the provider's news
      payment-event-dispatcher.ts  # the inbox: receive, process (every handler; set aside after MAX_EVENT_ATTEMPTS), the sweep, the prune
    infrastructure/
      payment-event.repository.ts  # the webhook inbox: record, findUnprocessed, markProcessed, recordFailure, findStale, pruneProcessed
      payment-event.queue.ts       # BullMQ, behind PaymentEventJobs: a job per event, the sweep, the daily prune
      payment-event.processor.ts
      stripe-client.ts           # the client both adapters build (STRIPE_API_VERSION), and cents back into euros
      stripe-payment.gateway.ts  # the guest's half: PaymentIntents, refunds, snapshot events
      payment.config.ts          # STRIPE_SECRET_KEY, STRIPE_PAYMENT_WEBHOOK_SECRET; no fallback (the payout secret and the site only outside production)
    presentation/
      payment-webhook.controller.ts  # POST /payments/webhook — verified, recorded, answered
  payout/                # the host's half of the money; follows booking and payment
    payout.module.ts       # imports BookingModule and PaymentModule; nothing imports it
    domain/payout.ts       # owedToHost, mayPayOut — the host's share after refunds and disputes
    domain/payout.types.ts # SettledStay, PayoutAccountHolder — what the repository answers and the service reads
    domain/payout.errors.ts # SettlementInProgressError — the settlement lease held past its wait
    application/
      payout.service.ts    # host payouts: the account, the transfer, reversals, refunds, disputes
      payout.service.spec.ts
      payout-event-handler.ts  # registers with the dispatcher and with StayLifecycle
      ports/payout-gateway.ts   # PayoutGateway — connected accounts, transfers, account events
      ports/payout-jobs.ts      # PayoutJobs — the payout jobs, as the service asks for them
    infrastructure/
      payout.repository.ts       # a stay's money after payment, and the payout account on a user
      stripe-payout.gateway.ts   # the host's half: Accounts v2 recipients, transfers, thin events
      host-payout.queue.ts       # BullMQ, behind PayoutJobs: the per-stay payout job and the hourly sweep
      host-payout.processor.ts
    presentation/
      payout-account.controller.ts   # GET /payouts/account, POST /payouts/account/refresh and /session
      payout-webhook.controller.ts   # POST /payouts/webhook — the thin account events, into the same inbox
      dto/payout.dto.ts
  review/                # the two-sided review of a finished stay
    review.controller.ts # no prefix: each route names its parent — a listing, a guest, a stay
    review.service.ts    # which half a caller writes, when a stay opens for review, who reads a guest's
    review.repository.ts # both lists reached through the booking, the summary, the unique pair
    review-cursor.ts     # keyset over created_at; the kind is in the resource tag
    review.service.spec.ts
    review-cursor.spec.ts
    dto/review.dto.ts
  waitlist/              # nights somebody else holds, and telling the waiters when they come free
    waitlist.controller.ts  # the caller's own list — @Roles(USER) on the class; /demand names ADMIN too
    waitlist.service.ts     # the refusals; announceFreed(), which BookingService calls and never throws
    waitlist.repository.ts  # join under two locks, the free check through holdsTheSlot, the claiming DELETE ... RETURNING
    waitlist.types.ts       # FreedNights, WaitingEntry — no Prisma, so the service reads them
    waitlist-cursor.ts      # the keyset cursor of GET /waitlist/demand
    waitlist-cursor.spec.ts
    waitlist.service.spec.ts
    dto/waitlist.dto.ts
  notification/          # what an account is told: the feed, the unread count, notify()
    notification.controller.ts  # the caller's own feed — no account id in any route
    notification.service.ts     # the row first, the event second; notify() never throws
    notification.repository.ts  # every query scoped by user_id; jsonb parsed by the contract
    notification-cursor.ts      # keyset over created_at, one ordering
    notification.service.spec.ts
    notification-cursor.spec.ts
    dto/notification.dto.ts
  realtime/              # the push transport: Redis pub/sub, one channel per account; no domain
    realtime.service.ts  # publish(userId, event), eventsOf(userId, opening), closing
  events/                # GET /events — the SSE stream, and the `sync` that opens it
    events.controller.ts
  unread/                # what an account has not read, across notices and threads
    unread.service.ts    # count() for the `sync` — what EventsController talks to
    unread.repository.ts # countUnreadOf(tx, userIds) under the advisory lock, one statement per account
    unread.types.ts      # UnreadCounts, unreadFieldsOf — no Prisma, so services read them
```

## Prisma

- Prisma 7 does not read `.env` on its own — `prisma.config.ts` loads the root `.env` through `process.loadEnvFile`; run the CLI only through the `db:*` scripts of `apps/api` (`pnpm --filter @repo/api db:migrate` and so on).
- The client is generated into `src/generated/prisma` (`prisma generate`, which also runs in `postinstall`); the directory is gitignored and in the ESLint ignores. The generator sets `importFileExtension = ""` — otherwise ts-node does not resolve the `.js` imports in the seed.
- Database access goes through `PrismaService` only (injected; `PrismaModule` is imported by the feature module). Do not create `new PrismaClient` inside services.
- **Every entity gets a repository.** The queries never sit in a service: they move one step further out, into a `*.repository.ts` next to it — `user/`, `auth/`, `listing/` and `booking/` all have one, and a new domain area comes with one in the same change. The repository owns the query, the transaction and the mapping of rows onto the contract types, and it translates driver-specific failures (a `P2002` becomes `EmailAlreadyRegisteredError`) so that no Prisma symbol reaches the service. Three helpers in `src/prisma/prisma.errors.ts` are what it translates through: `isPrismaError(error, code)` narrows the error, `violatedConstraint(error, leaf)` reads which constraint gave way, and `isExclusionViolation(error)` recognises the `EXCLUDE` constraint of phase 4. The second exists because Prisma 7 talks to Postgres through a driver adapter, which leaves `meta.target` and `meta.field_name` unset and reports what it knows under one nested path instead — that path is written down once there, and a repository only describes the leaf it expects (`{ fields }` for a unique conflict, `{ index }` for a foreign key). The third reads the same nested path for the raw SQLSTATE (`23P01`) rather than a Prisma code, which is generic for an exclusion violation and could move between versions. The service keeps the rules and the HTTP exceptions. The direction holds both ways: a type both layers need (`IssuedRefreshToken`) lives in `auth.types.ts`, so the repository never imports from a service. A repository is a plain `@Injectable()` class injected by its own type — not an interface behind a token: a second implementation of "Postgres" is never coming, and the seam that does need one is an external service (Stripe), not the database.
- The rule holds even where the module is plain CRUD, and `listing` is that case: the two files buy a service that can be unit-tested against a fake instead of a query builder, one place for `P2025` to become a `null` the service reads as a lost race, one place for the `deleted_at` of the soft delete below, and no second decision to take the day the module grows a rule. `booking` shows what that day looks like — it owns rules about who may read and cancel a row, and phase 4 added the locking transaction (`SELECT ... FOR UPDATE`, the lazy hold sweep, the `EXCLUDE` backstop) to the repository that was already there. What a repository does not get is an interface behind a token, see the line above: the split is between the rules and the queries, not between two implementations of Postgres.
- The check-in/check-out columns are `@db.Date`, while dates are exposed as `YYYY-MM-DD` strings (the mapper in `BookingService`); the contract did not change when the storage did.
- Money is the currency itself, exact to the cent: `listings.price_per_night` is `numeric(10, 2)` and never a float, because a float stores neither 120.10 nor the sum of a stay's nights exactly and the error accumulates across the nights. The contract refuses anything finer than a cent (`MONEY` in `packages/contracts/src/listing.ts`), so the column can never round a price the API accepted, and the repository is the one place a `Decimal` row becomes the `number` the contract speaks. A payment that wants minor units multiplies at its own edge rather than making every screen divide.
- **The ceiling on a price is written on both ends, and the two move together.** `MAX_PRICE` in the contract is what a request is refused against; `listings_price_within_contract` (a `CHECK`, raw SQL like the `EXCLUDE` constraint and the partial indexes) is the same number on the column. The number lives in the constraint rather than in the width of the type on purpose — the column holds a hundred times the ceiling, so moving it is a `CHECK` to rewrite instead of a table. The constraint is unreachable over HTTP — zod answers `400` first, which is why nothing translates SQLSTATE `23514` — and it exists for the writes that go around the API: the seed, a later migration, an import, `psql`. A price above the ceiling fails on the way out rather than on the way in, because the frontend parses every response against `listingSchema`, so one such row takes a whole catalogue page down with it. Raising the ceiling is one change in the contract plus a migration; raising it past `numeric(10, 2)` is the day the column changes too.
- **A nightly price is a default plus exceptions.** `listings.price_per_night` stays the default — the catalogue shows, filters and sorts by it alone — and two tables hold the exceptions: `listing_weekday_prices` (one row per listing and `Weekday`, an enum spelled in lower case so it is the contract's `weekdaySchema` as it is) and `listing_date_prices` (one row per listing and `@db.Date`). A night costs its date's price, else its weekday's, else the default — the order `listingPricingSchema` documents and `nightlyPrice` in `@repo/contracts` applies. The listing page quotes a stay by it, and so does the hold: `BookingRepository.create` reads the prices through `readPricedListing` (`src/listing/listing-pricing.ts`) under its `FOR UPDATE` lock and stores `quoteStay`'s total as the booking's `amount` — the same function, never a restatement of the order. `weekdays` is a strict object: an unknown key is a `400`, because a stripped one would be a `PATCH` that replaces the set with an empty one and answers `200`. Both tables cascade from the listing and carry the same price `CHECK` as the column (`*_price_within_contract`). They travel as `pricing` on `POST`/`PATCH /listings`, and a `PATCH` that carries it replaces the whole set: `ListingRepository.update` writes the listing row first in the same statement, which locks it, so two saves of one listing's prices queue instead of colliding on the key. The explicit `updatedAt` it adds to `data` whenever prices are present is what makes the row written at all — given nested writes alone, Prisma issues no `UPDATE` of the parent — and `test/listing.e2e-spec.ts` races ten saves to hold it there. Only `GET /listings/:id` reads them back (`listingDetailSchema`), and only the dates from today (UTC) on; past rows are never swept, they drop out of the reads and out of the table at the next save.
- A booking references a listing with `onDelete: Restrict` and a guest with `onDelete: Cascade`, and a listing references its owner with `onDelete: Restrict` as well. The restrict is deliberate — a listing somebody has booked is not something the database will let go of, because that would take their stay down with it — and it has to hold one level up too: a cascade from `users` would have to delete listings that bookings restrict, so it would promise an account deletion the database refuses to perform. Removing an owner therefore lets go of the listings first, which is the delete order everywhere rows are wiped anyway: bookings, then listings, then users (`test/database.ts`, `prisma/seed.ts`). A guest is the case that does cascade — their bookings are theirs to take with them.
- **`DELETE /listings/:id` retires the listing, it does not remove the row** (`deleted_at`). The constraint above is why: a booking names where the stay was, so the row has to outlive the offer, and refusing the delete outright reached an owner as a `409` that anyone with one finished stay in their history could never get past. Retired means out of the catalogue, off its owner's dashboard, `404` on the way back, and closed to new bookings — the stays already taken against it keep their record.
- **`ListingRepository` owns what "still offered" means**, and that is what makes the soft delete affordable: the condition is written once as the exported `STILL_OFFERED`, every read of the class is already narrowed by it, and a call site cannot forget a filter it has no way to spell. `deletedAt: null` is not spelled anywhere else — four queries over `listings` live outside the class, and each says whether it narrows. `ConversationRepository.start` does, by spreading `STILL_OFFERED`: a thread cannot begin about a retired listing. `BookingRepository.findByIdWithListingOwner` deliberately does not, because it resolves the listing of a stay whether or not it is retired and the stay is what the row was kept for; `LookupRepository.findListings` does not either, for the same reason — it offers the listings stays were taken against. Phase 4's `create` in `BookingRepository` reads `deleted_at` itself under the `FOR UPDATE` lock — the one place the check has to be atomic. A new query over that table has to answer the same question.
- **What every keyset page shares lives in `src/common/paging.ts`**, and the two that exist are what put it there: `Page<Row>` (`{ items, hasMore }` — the shape a repository answers with, `hasMore` rather than a count, which the service turns into `nextCursor`), the envelope a cursor is written in (`encodeParts`/`decodeParts` — the base64 spelling, the separator, the `sort` and the `id`), `readCursor`, the two refusals, and the `newest`/`oldest` pair every list offers (`CREATED_AT_ORDER`, `afterCreatedAt`). What stays with a resource is the half that knows the domain: which columns its orderings are made of and how each key is read back. **The first part of the envelope is the resource that issued the cursor** (`listings`, `bookings`), and it is not a formality — every list here spells a cursor the same way, so a `newest` one of the catalogue is a timestamp and a uuid exactly as a `newest` one of the stays is, and without the tag each would decode as a good place in the other. A third paged resource adds a tag and a key parse, and nothing else.
- **The catalogue is a keyset page, and the ordering, the cursor and the index are one decision.** `GET /listings` orders by the pair `ORDER_BY` in `listing.repository.ts` names, `catalogue-cursor.ts` encodes that pair into the opaque `nextCursor`, and a raw-SQL migration indexes exactly it, partial on `deleted_at IS NULL` — Prisma can spell neither the `WHERE` nor the sort direction, the same reason the `EXCLUDE` constraint is hand-written. Changing one of the three means changing all three. The comparison against the cursor is written out as a `where` rather than handed to Prisma's own `cursor` option, because that one resolves the row by id first and a listing retired between two pages would end the catalogue early; `limit + 1` rows are read so `nextCursor` can be issued without a second `count`. A cursor this API did not issue is a `400` — the value comes from a URL, so it is parsed as untrusted input, and a silent first page would answer a question nobody asked.
- **`GET /bookings` is a keyset page too, and the second one is what moved the shared half out.** The list has three scopes and one of them has no ceiling — an admin's is every stay on the site — so the read takes the same `cursor`/`limit` pair the catalogue does (`PAGING` in `packages/contracts/src/query.ts`, spread into both query schemas), issues the same opaque cursor (`booking-cursor.ts`, ordered by `created_at` or `from_date` with `id` behind it) and refuses one it did not write or one handed back under another `sort` with the same words (`readCursor` in `src/common/paging.ts`, called by both services). The indexes are the difference: none of them is partial — every status is readable, so nothing narrows this table the way `deleted_at IS NULL` narrows the listings — which is why they are declared with `@@index` on the model instead of in a raw-SQL migration. Two per scope that gets one, `(created_at DESC, id DESC)` and `(from_date DESC, id DESC)`, each again behind `guest_id`; the owner's scope narrows by `listings.owner_id` and therefore gets none, because no index of `bookings` can hold that filter and this ordering at once, and what bounds it is the owner's own listings rather than the site.
- **A filter narrows a scope and can never widen it, and the `AND` in `BookingRepository.findPage` is what makes that true.** The scope, the filters and the cursor go into `where` as three conditions of one `AND` rather than being spread into one object: `guestId` is both a scope and a filter, and spread the filter would replace the scope — a guest asking for `?guestId=` of somebody else would be handed their stays. Every one of the three has to hold, so the worst a filter can do is return nothing.
- **The ordering is the client's, out of a closed set** (`sort` in `listingQuerySchema`: `newest`, `oldest`, `priceAsc`, `priceDesc`). Four values rather than a field plus a direction, because the two are not independent: **the tiebreaker follows the direction of the key**, so `price ASC, id ASC` and `price DESC, id DESC` are exact reverses and one btree read both ways answers both — two columns disagreeing about direction would need an index apiece. That is why there are two indexes and not four, and why `oldest` needed no migration of its own. The switches in `catalogue-cursor.ts` and `afterCursor` are exhaustive, so a fifth sort stops compiling in every place that has to know about it — `ORDER_BY`, the cursor, and the migration it needs.
- **A cursor names a place in one ordering and in no other**, so it carries the `sort` it was issued under and `ListingService.readCursor` refuses it against another with a `400` of its own words. Reading it under a different sort would compare a price against a timestamp, and the rows after it would be a page of neither list; changing what the catalogue is ordered by starts the pages again, which is what dropping the cursor does.
- **The cursor's `where` says the key twice, and the redundant half is the one the index uses.** `key > X OR (key = X AND id > Y)` is the whole truth about where a page starts, but Postgres reads no start position out of an `OR`: it takes the index for the `ORDER BY`, walks it from the top and discards everything before the cursor with a filter, so a page deep in the catalogue costs what an offset costs — the one thing a keyset page exists not to do. `afterCursor` therefore emits `key >= X` beside the `OR`, implied by it as a condition and decisive as an index condition; a row comparison `(key, id) > (X, Y)` would say both at once, and Prisma cannot spell one. That bound is also why the result is `AND`-ed into the query rather than spread into it: on a price-ordered page it narrows the same column `minPrice`/`maxPrice` narrow, and a merge would let the later key replace the earlier one and drop the filter from every page after the first.
- **A `where` may cross between two repositories; a row mapping may not.** The catalogue's date filter asks for listings against which no stay both holds its slot and overlaps the window, and it imports `holdsTheSlot` and `overlapping` from `BookingRepository` rather than restating them — that way the catalogue and the transaction that refuses a booking cannot disagree about what "taken" means, and `holdsTheSlot` is written as the complement of `lapsedHolds` so those two cannot drift either. What does not cross is anything that turns a row into a contract type: the availability of one listing is a read over `bookings`, so it lives in `BookingRepository.findActiveRanges` and `ListingService` is given that repository, instead of a second place learning that dates are `@db.Date`.
- **A booking carries a summary of the listing it names** (`listingSummarySchema` — the title and the nightly price), and that read is deliberately not narrowed by `deleted_at`. It is the only thing on the API surface that resolves a retired listing: the row is kept so a stay can go on naming where it was, while `GET /listings/:id` answers `404` for it to everybody — that read is public and cached by URL on the frontend, so personalising it for whoever holds a stay is not available and would not be right. `toBooking` copies the two fields by name rather than spreading the row, because `findByIdWithListingOwner` selects the owner beside them for the authorization rules and it has no business in a response body.
- **The catalogue's three reading routes are `@Public()`** — the list, one listing and its availability. A catalogue nobody may see before signing up is not a catalogue, and the frontend caches those answers in a store keyed by URL and shared between visitors, so a read that needed a session could not be cached at all. Everything that writes to the catalogue stays behind the guard, and `GET /listings/mine` stays behind `@Roles(Role.USER)`: it is scoped to the caller, which is the opposite of public.
- **The trade is a guarantee the database no longer makes.** The row is still there, so the foreign key can no longer refuse a booking against a retired listing. Phase 4 closed that with the transaction in `BookingRepository.create`: it locks the listing row with `SELECT ... FOR UPDATE`, reads `deleted_at` under that lock, expires this listing's lapsed holds, refuses an overlap with an active stay, and inserts the hold — with the `EXCLUDE` constraint (below) as the backstop.
- The column stays out of `@repo/contracts`: retiring is how the storage answers "gone", and the API surface says it the ordinary way — absent from the lists, `404` by id.
- **`bookings.status` (`PENDING_PAYMENT | CONFIRMED | CANCELLED | EXPIRED`) and `expires_at`** are phase 4's. A booking is created a `PENDING_PAYMENT` hold with `expires_at = now + 15 min`; only `PENDING_PAYMENT` and `CONFIRMED` are "active" — the set `ACTIVE_STATUSES` in `booking/domain/booking-status.ts`, which the overlap check narrows to and the `EXCLUDE` constraint filters on. `DELETE /bookings/:id` moves the row to `CANCELLED` rather than deleting it (phase 6 refunds against the record). `booking/domain/` holds the status set, the legal transitions and the date-range rules as pure functions — no Nest, no Prisma.
- **"Active" is a rule about the slot, not about who may read a row.** The reads of `BookingRepository` are not narrowed by status: a cancelled or expired stay keeps answering the people who could always read it, with `status` saying which of the four it is. That is what puts the field on the contract in the first place — narrowing the reads as well would leave two of its four values unobservable through the API, and a guest whose hold lapsed would be told their booking never existed. What stays narrowed is every rule about the slot: the overlap check inside `create`, and the `where` of `cancel`, which is why cancelling twice is still a `404`. `expires_at` is not cleared when a booking leaves `PENDING_PAYMENT` either — when a hold stopped holding is what a refund asks about, and `status` already says that it did.
- **Hold expiry is three writes of one condition, and `lapsedHolds(now)` in `booking.repository.ts` is that condition** — `PENDING_PAYMENT` with a deadline at or before now, written once so the boundary cannot drift between the three callers.
- **`bookings_no_overlap` is an `EXCLUDE` constraint** (`btree_gist`, `daterange(from, to, '[)')`, `WHERE status IN ('PENDING_PAYMENT','CONFIRMED')`) — the last line of defence against a double booking, applied by a hand-written raw-SQL migration because Prisma cannot express it. The half-open range keeps back-to-back stays legal, matching the strict inequalities of the in-transaction overlap check. It surfaces as SQLSTATE `23P01`, read by `isExclusionViolation`.
- **Hold expiry has three halves, and the third one is why the other two may fail.** `BookingExpiryQueue.scheduleExpiry` puts a job in Redis for `expires_at` and `BookingExpiryProcessor` runs `BookingRepository.expireHold` on it (through `BookingService.releaseHold`, which tells both sides) — that is the precise release. The `updateManyAndReturn` at the top of `create`'s transaction is the lazy one, and it only ever looks at the listing being booked. Behind both is a **repeatable sweep**: a job scheduler (`SWEEP_INTERVAL_MS`, one minute) whose job runs `expireLapsedHolds` over every listing. It is not redundancy for its own sake — the queue has no volume under it, so a Redis restart drops every scheduled job, and without the sweep a hold on a listing nobody books again would keep its slot forever. That is also what lets `scheduleExpiry` and `cancelExpiry` swallow their failures: by the time either runs the booking is committed, so raising would answer an existing booking with a `500`, and the worst a lost job costs is up to a minute of delay. Redis (`REDIS_URL`, no fallback) is a service in docker-compose, pinned to `maxmemory-policy noeviction` because BullMQ requires it.
- **A search by a part of a column is a trigram index** (`pg_trgm`, GIN): `users.email`, `users.name` and `listings.title`, which the `name` and `email` filters of `GET /users` and the lookups of `/lookups` read with a `contains` — `LIKE`, or `ILIKE` with `mode: "insensitive"`, both of which the index serves and no btree can seek. Unlike the partial indexes above, Prisma can spell these (`@@index([title(ops: raw("gin_trgm_ops"))], type: Gin)`), so they are declared on the models; the extension is not, because Prisma no longer manages extensions, and is created by the migration that introduced the first of them. The contract's floor of three characters on a lookup is one trigram — the shortest search the index can answer.
- **A lookup answers with the rows its filter can match for the caller**, never the whole table: the owners of what is on offer, and the guests and listings of the stays the caller may read — the scope of `GET /bookings`, written once as `againstListingsOf` in `booking.repository.ts` and read by both. The listings it offers include retired ones (see `STILL_OFFERED` above). A `q` that parses as a uuid is matched against the id alone and whole — nobody remembers a part of one. An account is offered by its `name`, which is not unique, so an admin's lookup also matches the address and hands it back as `hint`; a host's lookup of their guests matches the name alone and answers `hint: null`, because a guest's address is not the host's to read. `LookupRepository` reads `users` and `listings` itself rather than through their repositories, taking only their `where`; its class comment says why.
- **A review is about a stay, and `kind` is who wrote it** (`LISTING` — the guest, about the place; `GUEST` — the host, about the guest). So `reviews` has neither an author nor a listing or guest column: the booking names both people, the two lists join through it (`booking.listing_id`, `booking.guest_id`, both indexed on `bookings`), and `@@unique([bookingId, kind])` is both the one-per-side rule and the seek of the join. Both halves go by the rows alone: the guest's is written by the stay's guest, the host's by whoever owns the listing — hosting is owning a listing, not a role. A stay at a listing retired since is still reviewable on both sides, deliberately: the stay happened. The guest's half then waits unread — `GET /listings/:id/reviews` answers `404` for a retired listing — and counts again if the listing is ever offered again. What the join costs is bounded by the stays of one listing or one guest — the trade the owner's scope of `GET /bookings` already makes. The rule for when a stay opens is `isReviewable` in `@repo/contracts` (`CONFIRMED`, check-out day reached, UTC), read by the service and by the card that offers the form. A second review of one half is the unique key's `P2002`, not a read first, because two submits race. The rating's bounds are a raw-SQL `CHECK` (`reviews_rating_within_contract`) beside the contract's, for the reason the price ceiling has one. Reviews cascade with their booking; nothing in the API deletes a booking, so that is the guest's account and the cleanups.
- **The host's half is not public.** `GET /guests/:id/reviews` answers the guest themselves (whatever their role now), an admin, and any user the guest has a live hold or a confirmed stay with as a host — `BookingRepository.hasStayedWith`, `holdsTheSlot` over the `againstListingsOf` scope of the owner's page of stays — and `404` to everybody else, for the reason a booking does. A cancelled, expired or lapsed request grants nothing: having asked once is not a standing licence to read a guest's record, so the owner's page can show a stay whose guest's reviews it no longer opens. The guest's half is `@Public()` and widened by `CATALOGUE_READS`, because the frontend caches it beside the listing.
- **A conversation is one thread per guest and listing** (`@@unique([listingId, guestId])`), and its host is never stored: it is read through `listings.owner_id`, so every rule about a thread names the same person every other rule about that listing does. Only a `USER` starts one (`POST /conversations`, an upsert that Prisma issues as one `INSERT ... ON CONFLICT DO UPDATE`, so a second first message, concurrent or not, continues the thread — which holds only while its `update` is non-empty: an empty one becomes a `SELECT` and an `INSERT`, and a concurrent first message fails with `P2002`), either side replies, and a side is decided by the account (`ConversationService.sideOf`) rather than the role; anybody else gets a `404`, for the reason a booking does. The list follows the same rule, and unlike the stays it has no `side`: `GET /conversations` answers every thread the account is a side of, the ones it started as a guest and the ones about its listings, together. The two halves are two keyset reads merged in `findPageFor`, never one `guest_id = $1 OR listings.owner_id = $1`: Postgres seeks no index through an `OR` that crosses into another table, so that query scans every thread on the site (25 ms at 520k threads for a guest with seven, against 0.05 ms for the guest half alone). The listing is read narrowed by `STILL_OFFERED` when a thread starts — the fourth query over `listings` outside its class — and not afterwards: a thread outlives a retired listing the way a stay does, so `conversations` restricts its listing and `resetDatabase`/the seed delete it before the listings. Messages say which side wrote them (`GUEST`/`HOST`); the thread carries both people's `name` — the host's read through the listing — and neither address, the rule a host's lookup of their guests follows too. `last_message_at` is denormalised onto the thread because it is the key of the list's keyset, written in the same transaction as the message and from the same moment; `last_message_body` and `last_message_sender` sit beside it because the list shows the newest message on every card, and reading it through the relation with `take: 1` loads every message of every thread on the page — Prisma applies a nested `take` in memory when there are several parents. **A message locks its thread** (`SELECT ... FOR UPDATE` in `appendIn`) and takes its moment only after the lock, at least a millisecond past the thread's newest message — so the messages of one thread are strictly ordered by commit, and a reply whose clock read came first but whose commit came second cannot set `last_message_at` back past the other side's message, which would mark that message read and break the cursor written from it. Each side has its own read marker (`guest_read_at`, `host_read_at`), which sending stamps for the sender, and `unread` is "the newest message is later than my marker". Marking read is its own `POST`, not a side effect of a `GET`, and it carries `upTo` — the newest message the screen showed — rather than stamping the moment it arrives: a message written between the render and the request stays news. The marker only moves forwards and never past the thread's newest message.
- **A notification is a row first and an event second.** `notifications` holds the record — `type` plus a `jsonb` `data` that is one value of `notificationContentSchema`, parsed back against the contract by `toNotification` because nothing in the database holds the column to its type. The data is a copy of what was true at the time (a title, the dates), not a key resolved on read, which is why there is no foreign key to the booking or the review; the row cascades with its recipient. The feed is a keyset page over `(user_id, created_at DESC, id DESC)`, and the unread count has a partial index on `read_at IS NULL` in the migration's raw SQL. Every query is scoped by `user_id`, the writes by id included, so somebody else's id is a `404` without a read first.
- **`NotificationService.notify` never throws**, for the reason `scheduleExpiry` does not: it announces a write another module has already committed. The callers are `BookingService` (a hold → the host; a cancellation → both sides except the canceller; a lapsed hold → both sides) and `ReviewService` (a review → the side it is about). **A lapsed hold is told about by whichever of the three paths released it**: each is an `updateManyAndReturn` that reads back the rows it flipped (`ReleasedHold` — the stay as a notice copies it, the guest and the listing's owner), so of two paths racing over one hold only the one whose `UPDATE` matched it hears about it, and the notice cannot go out twice. The lazy path hands them back from `create` (`CreatedBooking.released`) and a refused booking rolls the release back with it, so nobody is told about a hold that is still pending. `BookingExpiryProcessor` goes through `BookingService.releaseHold`/`releaseLapsedHolds` rather than the repository for that reason. Nobody let a lapsed hold go on purpose, so both sides hear (`BOOKING_EXPIRED` with `recipient`); the two are always different people, because nobody may book their own listing. On the lazy path the release's notices are written before the new hold's, because the feed is ordered by when a notice was written and the release came first. **The notice is at most once, never at least once**: the flip commits before the notices are written, so a process that dies between the two loses them, and no later run repeats them — the `UPDATE` that would have to has nothing left to match. Every `notify` makes that trade, but a cancellation at least has the canceller who knows; nobody knows of a lapse unless told. An outbox written in the transaction of the flip is what would close it, and it is not built.
- **The stream (`GET /events`) is Server-Sent Events, and it is the only push channel.** SSE rather than WebSockets because it is plain HTTP: it goes through the frontend's BFF and carries the session cookie like any other request, and everything a browser says still goes through the ordinary routes. `RealtimeService` fans events out over Redis pub/sub — one channel per account, subscribed while any connection of that account is open on this instance — because the instance that writes a notice is not necessarily the one holding the connection. Delivery is best effort: each connection opens with a `sync` carrying the counts — read only once Redis has confirmed the channel, so nothing falls between the two — and every event carries the absolute count rather than a delta, so a missed event is repaired by the next one. Every count of an account — the unread notices and the unread threads, together — is taken by `countUnreadOf` (`src/unread/unread.repository.ts`) under a per-account advisory lock (`pg_advisory_xact_lock`) in the same transaction as the write before it, and carries the database clock read under that lock as `unreadRevision`: two requests publish in whatever order Redis receives them, and the revision is what lets a client keep the newer count. A subscribe that fails ends the streams waiting on it, and the channel is forgotten, so the browser's reconnect subscribes again. A publish gives up after a second (`commandTimeout`), so a silent Redis cannot hold a request whose write has committed. The controller closes a stream after five minutes (`STREAM_LIFETIME_MS`): the guard reads the token once, at connect, and the reconnect is what applies a block or an expiry to an open tab. A comment line every 25 seconds keeps proxies from taking the stream for idle. `RealtimeService.closing` ends every stream in `onModuleDestroy`, which Nest runs before it closes the HTTP server — otherwise Express would wait for each open stream to reach its five minutes, on every deploy and every restart under `--watch`. `RealtimeService` closes its connections with `disconnect`, not `quit` — a `QUIT` queued behind a handshake keeps Jest from exiting.
- **The messages between users join the same stream.** `ConversationService` publishes `message.created` to both sides of the thread (the first message of a new one included) and `conversation.read` to the reader when a marker moved; every event, notices' included, carries `unreadNotifications` and `unreadConversations` with one `unreadRevision`. So every write that moves either count counts both: `ConversationRepository.append`, `start` and `markRead` call `countUnreadOf` inside their transactions, after the thread's row lock — the order every caller keeps, and several accounts are locked sorted by id, so two messages crossing between the same two people cannot deadlock. A thread is unread for a side while `last_message_at` is later than that side's marker, counted in two halves for the reason `findPageFor` reads two. A message is **not** a `notify`: the thread holds its own unread state, and a notice per message would bury the bookings and reviews on the bell. The notification routes still answer `{ unread, revision }` — the bell's half, on the same revision sequence. `EventsController` reads the opening `sync` through `UnreadService.count`, like any controller through its service. The count after the lock is one statement (two subqueries for the threads, one for the notices, and the clock), not one before the lock: under `READ COMMITTED` a statement that waited for the lock would read the snapshot from before the commit it waited for.
- **A waitlist entry is a wish, not a claim, and the API never books for a waiter.** A booking is a 15-minute hold its guest has to pay; taken for somebody who is not looking it would lapse, keep the nights off the calendar meanwhile, and send a second round of notices. So `waitlist_entries` holds nothing — neither the overlap check nor the `EXCLUDE` constraint reads it — and when nights stop being held `BookingService` hands them to `WaitlistService.announceFreed` on every path that frees them: a cancellation and all three expiry paths (the lazy one inside `create` only after the new hold is in, so nights it took back are news to nobody). Every entry on that listing whose nights overlap the freed ones and whose **whole** range no stay now holds (`holdsTheSlot`, imported from `booking.repository.ts` like the catalogue does) is deleted and its owner told — all of them at once, `WAITLIST_AVAILABLE`, and the first to book takes the nights. That is two reads whatever the number of waiters — the candidates, then every stay holding a night in the span they cover — and one `DELETE ... RETURNING` for the claim. The `DELETE` comes before the notice and only the call it matched tells anybody, so two releases racing over one entry tell one person once: at most once, the trade every `notify` makes, and `announceFreed` never throws for the same reason. `join` locks the listing row (`FOR UPDATE`, the lock `create` takes) so its "are these nights held" read cannot interleave with a booking, and then the caller's own row, which serialises two joins of one account so the cap (`MAX_WAITLIST_ENTRIES`) and the duplicate check count what the other wrote; joining twice answers the entry already there. Free nights are a `409` — the answer to them is booking — and the only one: a full list and a range only the caller's own stays hold are a `403`, so the frontend reads a `409` as its calendar being stale. The cap counts what `GET /waitlist` shows, entries on a listing still offered. A cancellation and a lapsing hold do not take the listing lock, so one can commit and announce between `join`'s read and its commit; `WaitlistService.join` therefore announces the joined range once more after the commit, and a release is either visible to that read or its own announcement sees the entry. An entry whose check-in has passed is left out of every read and deleted at the owner's next join. **The other side of the list is `GET /waitlist/demand`**, a keyset page scoped by the role the way `GET /bookings` is (`WaitlistService.demandFor`, the same exhaustive switch): a user is answered the entries on their own listings, an admin every entry, both still ahead and on a listing still offered. Only the admin's carries `waiter` (the id and the name); a host's is `null`, because a waiter has taken nothing from the host yet and a booking is what introduces a guest. Its two orderings (`checkInAsc`, the default, and `newest`) have an index apiece on the table; the host's scope narrows through `listings.owner_id` and gets none, the trade the owner's page of stays makes. `WaitlistModule` imports nothing of `BookingModule`, which is what lets `BookingModule` import it. The entries cascade with their listing and their user, so `resetDatabase` and the seed need no line for them.
- A model change means a migration (`db:migrate`), and the migration files are committed.
- `db:migrate` is `prisma migrate dev` and belongs to a developer machine only — it can decide to reset the database. A deployed environment runs `db:deploy` (`prisma migrate deploy`), which only applies what is already committed; that is what `.railway/railway.ts` hangs on `preDeploy`.
- **Resetting the local dev database during a migration is allowed.** When `db:migrate` asks for a reset — drift, an applied migration edited after the fact — accept it (or run `pnpm --filter @repo/api exec prisma migrate reset`) and follow with `db:seed`; the local data is demo data the seed writes back. Do not work around the prompt with `migrate diff` plus `db:deploy`. This holds for the database the root `.env` points at on a developer machine only, never for a deployed one.
- **Under Claude Code the reset needs the user's explicit consent, every time.** Prisma detects an AI agent through the environment and refuses `migrate reset` (and a `migrate dev` that wants one). A command the user types with `!` runs in the same session environment, so handing the command back to them does not get around it. Ask first — through the structured question tool where there is one — and say four things: the exact command, why it is needed (a migration edited or added), that every row in the database is destroyed, and which database it is (the `POSTGRES_*` one from docker-compose on `localhost`, a development database, never a deployed one). Only after a clear "yes" rerun it with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set to the user's answer verbatim, then `db:seed`. Permission given for one reset does not cover the next.
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

- A response never uses a DTO class as its TypeScript type — the controller keeps returning the contract type (`Promise<Booking>`, `Promise<Listing[]>`), because a return type is erased at compile time and documents nothing to Swagger. Where a response is worth documenting in `/docs`, the same `createZodDto` wrapper exists in the module's `dto/*.dto.ts` (`BookingDto`, `ListingDto`, `UserDto`) purely to be handed to `@ApiOkResponse`/`@ApiCreatedResponse`/`@ApiOkResponse({ isArray: true })`; the error body a service can throw (404/409/…) is documented the same way against `ApiErrorDto` (`src/common/dto/api-error.dto.ts`, wrapping `apiErrorSchema`). `@Roles()` already carries its own `ApiForbiddenResponse` — a route only adds the exceptions its own service throws. The exception is a route whose service throws `403` as well: a guard refusing the role and a service refusing the row are one status with two reasons. Nest joins the descriptions of the two decorators rather than letting one replace the other, so the handler adds only the reason `@Roles` does not know about (`NOT_YOUR_LISTING` in `listing.controller.ts`) — repeating the role there would read back doubled. Decorators apply bottom-up and a reordering would drop a half silently, which is why `test/openapi.e2e-spec.ts` asserts that both survive. The joining only happens on one target: `@Roles` on the **class** and an `ApiForbiddenResponse` on the **method** are merged per status as `{ ...class, ...method }`, so the method's 403 replaces the class's whole and has to restate the role itself (`PATCH /users/:id`).
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
  `@Public()` reads — the three of the catalogue and a listing's reviews — are the case for
  widening it (`CATALOGUE_READS` in `src/common/throttle.ts`, 600 a minute, shared by both
  controllers). They are the only reads the frontend caches,
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
  an ended session rather than a missing resource. A blocked account is the same case
  (`UserRepository.findActiveById`).
- **Blocking ends every session at once and the access token within `JWT_ACCESS_TTL`.**
  `UserRepository.update` stamps `blocked_at` — only while it is empty, so two blocks at
  once keep the first moment — and deletes the account's refresh tokens in
  one transaction — the one write that reaches into `refresh_tokens` from outside
  `RefreshTokenRepository`, because the two halves are one decision. Login answers `403`
  only after the password verified, so the block is news only to the account's owner;
  `/auth/refresh` refuses a row whose account is blocked (a login that raced the block) and
  revokes its family. What is left is an access token, which `JwtStrategy` does not check
  against the row — the same trade a role change makes. There is no account deletion: a
  block is the reversible answer, and the rows stay the record.
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
- **Two roles, `USER` and `ADMIN`; hosting is not one of them.** Whoever owns a listing
  hosts it and whoever booked a stay is its guest, so one `USER` is a guest of some stays
  and the host of others, and every rule about "the host" reads `listing.owner_id`, never
  `user.role`. Any user may publish a listing; an account cannot book its own
  (`OwnListingError` off the row `BookingRepository.create` already locks → `403`, the
  answer `POST /conversations` gives about one's own listing). A gate on hosting, should
  one be needed (verification, payouts), is a flag such as `hostOnboardedAt`, not a role.
- **Membership of a set, not a hierarchy.** ADMIN does not pass an `@Roles(Role.USER)`
  check by being senior to a user. A route admins may use names `ADMIN` itself, so what a
  role can reach is readable where the route is written — and `@Roles(Role.USER)` on
  "create a booking" keeps meaning what it says instead of quietly admitting the role
  above it.
- **The ownership check is not a guard**, and `src/auth/ownership.ts` says why: a role is a
  claim of the token and is known before the handler runs, while ownership is a property of
  a row and cannot be known until the row is read. A guard that decided it would fetch the
  row the handler is about to fetch anyway. So it lives in the service, next to the read.
  A `403` from the guard means "not your kind of endpoint", a `403` from the service means
  "not your row". `ownsOrIsAdmin` is where the one real hierarchy lives — an admin passes
  without owning anything, and that is a rule about rows rather than about endpoints.
- **A scope is neither of the two.** What `GET /bookings` returns depends on the caller, and
  that goes into the `where` of the query (`pageFor` in `BookingService`), not into a
  filter the client may pass: a query that cannot return a forbidden row needs no check
  after it. An admin's scope is every stay; a user's is one of two halves of their own,
  and `side` (`GUEST`, the default, or `HOST`) picks which — it chooses between two scopes
  of the caller's and never reaches past them, which is why the client may pass it. The
  lookups take the same `side` (`LookupService.listings`), and `/lookups/guests` answers a
  user with no listings an empty page rather than a `403`. The switch over the role is
  exhaustive on purpose — a third role stops compiling there instead of falling through to
  a scope somebody has to guess at — and it picks one of three named queries on
  `BookingRepository` rather than assembling a `where`, so an unhandled role reaches no
  query at all instead of an unscoped one. Its `default` assigns the role to `never` and
  throws, because the type is not the whole guarantee: the role arrives in a signed access
  token that `JwtStrategy` does not parse against the contract, so one minted before a role
  was retired still carries the old name for as long as `JWT_ACCESS_TTL` — the `OWNER`
  removed by `20261021120000_drop_owner_role` lands there and is refused until the next
  refresh.
- **Reading and writing are separate rules over the same row.** A host reads the bookings
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
  `USER`; an admin changes a role through `PATCH /users/:id`, and never their own — the
  `403` from `UserService` keeps a site from losing its last admin by one click. That route is also the one place the role is read from the row rather than the token: `UserService.update` refuses a caller whose account is no longer an active admin, because an admin who was just blocked or demoted would otherwise keep up to `JWT_ACCESS_TTL` to block the admin who did it. The caller's row is read in `UserRepository.update`, locked with the target's (`SELECT ... FOR UPDATE`, ordered by id) inside the transaction that writes — a read before it would let two admins blocking each other at once both through and leave the site with none (`CallerNotAdminError` is what the service turns into the `403`). The own-account check compares the id lower-cased, because `ParseUUIDPipe` accepts an upper-case UUID that Postgres resolves to the same row. `JwtStrategy` reads no database, so a promoted user carries the old role until
  the next refresh — the e2e helper `signInAs` logs in again after promoting the row for
  exactly that reason. The migration that retired `OWNER` turns every such row into a
  `USER` before it casts the column — Postgres cannot drop an enum value, so it is a new
  type and an `ALTER COLUMN ... USING`, which would refuse a row still holding the old one.

## Payments

Stripe, through PaymentIntents and Elements. Three modules are split into `domain/`,
`application/`, `infrastructure/` and `presentation/` — the departure `docs/plan.md` plans
for them and for nothing else — because the money has several entry points into one set of
rules (HTTP, the webhooks, the BullMQ jobs) and two external worlds (Postgres, Stripe):
`payment` is the provider's side, `booking` the stays, `payout` the host's share.

- **The dependencies run one way, and registries are how the other way is reached.**
  `payment` imports no stay; `booking` imports `payment`; `payout` imports both and nothing
  imports `payout`. What a webhook event means is decided by whoever registers a
  `PaymentEventHandler` with `PaymentEventDispatcher` in `onModuleInit`:
  `BookingPaymentHandler` (a payment, a refund, a lost dispute) and `PayoutEventHandler`
  (disputes, and the news about hosts' accounts). Each writes only its own columns, so the
  order they run in does not matter. What the booking side has to tell the payout side — a
  stay confirmed, a refund recorded — it tells `StayLifecycle`, an awaited registry rather
  than an event bus: a listener that throws fails the caller, and the event is retried.
- **The port is the external service, not the database.** `PaymentGateway` and
  `PayoutGateway` are abstract classes, which Nest takes as their own injection tokens; the
  Stripe adapters are provided behind them. The unit specs fake the ports, and
  `test/payment.e2e-spec.ts` overrides the payment one with the real adapter minus its
  outgoing calls, so the signature check is the production code. A gateway speaks the
  contract's money — euros to the cent — and only the adapter multiplies into cents.
- **The webhooks are an inbox** (`POST /payments/webhook`, `POST /payouts/webhook`). A
  delivery is verified (the signature over the raw body — `src/common/body-parsers.ts` keeps
  the bytes for these two routes only), written to `payment_events` and answered `200` at
  once; the `payment-event` queue's worker handles it afterwards and stamps
  `processed_at`. Stripe expects a `2xx` within seconds, and the work behind an event calls
  Stripe and waits for leases. The worker runs four events at a time, so one waiting on a
  lease or on Stripe does not hold the rest behind it. A failed run is retried with a growing pause, and a
  repeatable sweep re-queues an event a lost job left unprocessed, a hundred at a time
  (`payment_events_unprocessed_idx`, partial). **Every failed run is counted on the row**
  (`attempts`, `last_error`), and after `MAX_EVENT_ATTEMPTS` (24 — three rounds of the
  job's own eight, about half an hour) the event is set aside (`failed_at`): neither the
  worker nor the sweep touches it again, and every admin is told (`PAYMENT_EVENT_FAILED`).
  An event that fails the same way every time would otherwise be retried for good with
  nobody told. **A run that finds the stay held by another — a cancellation's or a
  settlement's lease — is no failure**: the handler throws `PaymentEventBusyError`, which
  the dispatcher retries without counting, since a lease runs out on its own. Clearing
  `failed_at` and `attempts` hands it back to the sweep. A daily job
  deletes the events processed more than `EVENT_RETENTION_DAYS` (90) ago — Stripe
  redelivers for three days, so nothing older has anything left to deduplicate. An unsigned delivery is a `400`; one that
  could not be recorded a `500`, which Stripe delivers again. Both routes are `@Public()`,
  `@SkipThrottle()` and out of `/docs`. The payout webhook's thin events become a
  `PaymentEvent` of kind `account` and go through the same inbox.
- **The handlers are idempotent on their own**, which is what makes retrying safe:
  `confirmPayment` is a conditional `updateManyAndReturn` on `PENDING_PAYMENT` (whatever the
  deadline — a lapsed hold no path has released still holds its nights), every write to
  Stripe goes under an idempotency key, and a refund is looked up by its key before it is
  sent, so it goes out once even after Stripe forgot the key. Stripe does not order its
  deliveries, so a refund or a dispute of a payment whose hold is still pending, unpaid and
  unrefunded (`awaitsItsPayment`) arrived before the payment's own news: it throws
  `PaymentNotConfirmedYetError` and comes again, counted, rather than being read as news
  about a payment that never confirmed a stay — the hold is confirmed or released within
  minutes, well inside `MAX_EVENT_ATTEMPTS`.
- **The amount is the server's.** The hold is priced inside the locking transaction
  (`quoteStay` over `readPricedListing`), stored as `bookings.amount`, and charged as it is.
  A stay costs between `MIN_CHARGE` and `MAX_CHARGE` (`domain/stay-price.ts`, Stripe's floor
  and ceiling for one charge); `create` refuses a quote outside them with a `422`.
- **One PaymentIntent per hold, opened by the payment form.** `POST /bookings/:id/payment`
  opens it under `booking-<id>-payment` and answers its `client_secret`; a second call
  replays the same intent, and `attachPayment` writes its id only into an empty column and
  only while the hold is pending — a hold released while Stripe answered gets the intent
  withdrawn and the caller a `409`. Only the guest is answered (`403` to the host and an
  admin), and only while the hold is pending and inside its deadline (`409`). A `POST`
  because it opens something at Stripe; the frontend calls it from the browser, never from a
  render. The intent carries `metadata.bookingId` and `metadata.site` (`STRIPE_SITE`): a test
  account is shared by every developer's `stripe listen`, so a payment another site opened
  reads as naming no booking and is left alone.
- **A payment that confirms nothing is refunded** in full under `payment-<pi>-unheld`, and
  the guest is told (`PAYMENT_REFUNDED`) by the run whose `recordRefund` wrote the empty
  column — capped at `amount`, which the column's `CHECK` holds it to. A booking this
  payment confirmed (`paid_at`, never cleared) is a redelivery and refunds nothing even if
  it was cancelled since. `confirmPayment` confirms only with the intent the row names (or
  none yet), and another intent naming the same booking goes back without touching the
  row's refund total. A payment naming a booking this database does not hold is left alone
  and logged, like one naming none: there is no account deletion to have taken the row, so
  it belongs to another database.
- **Only payment methods that confirm at once are offered, and the code says which.** A
  method that stays `processing` for days outlives its fifteen-minute hold and is refunded
  in full when it lands, so the intent is opened with `allowed_payment_method_types` set to
  `INSTANT_PAYMENT_METHODS` (`stripe-payment.gateway.ts`) — not `payment_method_types`, which
  the pinned API version refuses with a `400`. The dashboard still decides which of them are
  switched on: Stripe drops a listed method that is not enabled instead of failing the
  payment. A method added to the list has to be one Stripe confirms immediately.
- **A cancellation is final when it is answered, and its refund follows it.**
  `DELETE /bookings/:id` calls no payment provider. A hold can be cancelled at any time, a
  confirmed stay only before its check-in day — by the guest and by an admin alike
  (`isCancellableOn`, `409` once it has begun). `refundOnCancel` decides the amount — the
  guest in full until 48 hours before check-in and nothing after, an admin in full — capped
  by what the row records as refunded, and `cancel` writes it as `refund_owed` in the
  statement that writes `CANCELLED`. The `refund-cancellation` job sends it under
  `booking-<id>-cancellation` (one cancellation per booking, so no amount in the key), capped
  again by what Stripe says is left, and `settleOwedRefund` raises `refunded_amount` by what
  the refund named by that key gave back and clears the debt in one transaction. A refund
  Stripe refuses is retried by the job, and a sweep of its own on the same queue — apart
  from the hold sweep, so a slow Stripe holds back refunds alone — pays every debt still on
  a row whose cancellation lease is not running, fifty at a time and the fewest failures
  first (`bookings_refund_owed_idx`). That lease is compared on the database's clock, in raw
  SQL, because it was written with it. The worker runs four jobs at a time, so a refund
  waiting on Stripe does not hold a release behind it. A dispute opened after the
  cancellation leaves the debt waiting, out of the sweep — won, it is paid; lost, dropped. A
  disputed payment cannot be refunded: an open dispute is a `409`.
- **A debt or a payout that keeps failing is set aside**, the way the inbox sets an event
  aside: every failed run counts on the row (`refund_attempts`/`refund_last_error`,
  `payout_attempts`/`payout_last_error`), the sweeps read the fewest failures first so a
  failing row cannot fill a batch, and after `MAX_REFUND_ATTEMPTS` (30, about half an hour of
  the minute sweep) or `MAX_PAYOUT_ATTEMPTS` (24, about a day of the hourly one) the row is
  stamped `refund_failed_at`/`payout_failed_at`, the sweep leaves it alone, the job stops
  retrying and every admin is told (`CANCELLATION_REFUND_FAILED`, `PAYOUT_FAILED`). Clearing
  the stamp and the counter hands it back; the admin screen for that is in `docs/plan.md`.
- **The per-booking leases** (`infrastructure/booking-lease.ts`): `cancelling_until` for a
  cancellation, its refund job and the payment webhooks (`whileCancelling`, sixty seconds,
  three of waiting), and `settling_until` for the settlement of the host's payout
  (`whileSettling`). A lease rather than a lock an open transaction holds, because the work
  under it calls Stripe and a pinned connection per caller starves the pool. The deadline
  is the database's clock, so instances with clocks apart agree on it. The holder renews
  the lease every third of its length while the work runs, so slow work keeps the row;
  only a holder that died or froze loses it, and a renewal that finds the lease taken
  logs the loss when the work ends instead of taking it back. One that waits too
  long is a `409` to a cancellation and a retry to a job or an event.
- **The API version is pinned** (`STRIPE_API_VERSION` in `stripe-client.ts`, the version
  the installed SDK is typed against — the compiler refuses another). The webhook
  endpoints in the Dashboard have to deliver in that version; `readEvent` warns once per
  process about an event in another. Locally `stripe listen` runs with `--latest`, which
  is the same version while the installed SDK is current.
- **Stripe is called with four seconds a call and no retry of the SDK's own**
  (`stripe-client.ts`). What retries instead is whatever ran the call — a person pressing
  the button again, a job's next attempt — safe because every write goes under a key.
- **A refund the bank sent back** (`refund.failed`) is kept in `refund_failures` — keyed by
  the refund's id, no relation to a booking — and told to every admin (`REFUND_FAILED`)
  by the delivery that wrote the row. The stay goes on recording it as refunded: the money
  is the guest's, and a person issues it again and stamps `resolved_at`.
- **The money columns carry `CHECK`s** (`bookings_amount_positive`,
  `bookings_*_within_amount`): an amount above zero, and nothing refunded, owed or paid out
  beyond it — for the writes that go around the API, as the price columns have.
- **Notices**: `BOOKING_CONFIRMED` to both sides, `PAYMENT_REFUNDED` to the guest of a late
  payment or a dashboard refund — through `notify`, which never throws. What only a person
  can put right goes to every admin through `notifyAdmins` (`REFUND_FAILED`,
  `PAYMENT_EVENT_FAILED`, `CANCELLATION_REFUND_FAILED`, `PAYOUT_FAILED`). A redelivery of a
  payment that confirmed a still-confirmed stay repeats the payout's scheduling and the
  notices unless `confirmation_announced_at` says they were done; the whole event runs under
  `whileCancelling`, so two runs over one payment tell both sides once.

### Host payouts

Stripe Connect as a marketplace, with **separate charges and transfers**: the guest pays the
platform, and the host is paid their share by a transfer once the stay has begun.
`PayoutService` owns it.

- **The rule is the contract's.** `hostShare` (what is left after refunds, less
  `PLATFORM_FEE_RATE`, in whole cents) and `payoutDueAt` (`PAYOUT_DELAY_HOURS` after
  midnight UTC of check-in) live in `packages/contracts/src/payout.ts`, because the host's
  screen states them. `domain/payout.ts` adds what only the API knows: nothing is owed for
  an unpaid stay or a lost dispute, a refund owed counts as refunded, and nothing leaves
  while a dispute is open.
- **A host is an Accounts v2 recipient**, opened by the first
  `POST /payouts/account/session` under `user-<id>-account` and written only into the empty
  `users.stripe_account_id`. Onboarding is Stripe's embedded component on the frontend.
- **`users.payouts_enabled_at` selects a payout and Stripe's answer releases it**: `payOut`
  asks `transfersEnabled` again right before the transfer, and a lapsed account is held back
  and the flag switched off. The flag is written from the account events and from
  `POST /payouts/account/refresh`, which the payouts screen calls while onboarding is
  unfinished; `GET /payouts/account` only reads the row. The write that switches it on
  queues a `pay-host` job rather than paying inside the request or the event.
- **Bookings are never refused for a host who cannot be paid.** Their payouts wait.
- **Two halves, like hold expiry**: a delayed job per stay at `payoutDueAt` (`payout-<id>`)
  and an hourly sweep, a hundred stays a run, the fewest failures first, over
  `bookings_awaiting_payout_idx` (partial: paid, no transfer, not set aside), which leaves
  out a stay refunded in full or owed a refund.
- **A transfer is idempotent and recorded once**: funded by the stay's own charge
  (`source_transaction`), sent under `booking-<id>-payout` — no amount in the key, so a retry
  cannot send a second one — and looked up by `transfer_group` and `metadata.bookingId`
  before it is sent, because Stripe forgets a key after 24 hours. `transfer_id` is written
  only into an empty column. Those three, not a lease, are what keep the stay's job, the
  sweep and a host's `pay-host` job — run four at a time by the worker — to one transfer. A
  refund or dispute that lands while the transfer is in flight does not undo the write;
  `settle` takes back the difference straight after.
- **`settle` is the one place that takes money back from a host**: under `whileSettling` it
  compares `paid_out_amount` with what is owed now and, when the row says more is held,
  asks Stripe what the transfer still holds — a reversal whose write was lost is already
  off it — reverses the difference under `booking-<id>-reversal-<held cents>-<owed
cents>` and lowers `paid_out_amount` from exactly what it read. Two settlements of one stay queue on the lease instead of reversing the same money
  twice; `test/payout.repository.e2e-spec.ts` runs the lease against the real database.
- **A refund** (`charge.refunded`) is the booking side's: it raises `refunded_amount` to
  Stripe's total, tells the guest of a refund this API did not send, cancels a stay not yet
  begun refunded in full — one under way or over keeps its status and its nights, as a lost
  dispute's does — and announces the refund to `StayLifecycle`, where `PayoutEventHandler`
  settles.
- **Disputes** move forward only — `OPEN` from none, `WON`/`LOST` from none or `OPEN` —
  because Stripe does not order its deliveries. Opened, the host is told (`PAYMENT_DISPUTED`)
  and nothing moves; won, the stay's `pay-out` job is queued; lost, `settle` reverses what
  was sent and the booking side cancels the stay if its check-in has not come.
  `PAYOUT_SENT` tells the host about each transfer.
- **Stripe's side has to be set up once**: Connect enabled with the platform profile and
  loss liability accepted, and — deployed — a second event destination for the thin
  account events with its own secret (`STRIPE_PAYOUT_WEBHOOK_SECRET`, which falls back to
  `STRIPE_PAYMENT_WEBHOOK_SECRET` outside production only, because `stripe listen` signs both
  kinds with one; with `NODE_ENV=production` a missing one stops the boot).

## main.ts

`src/main.ts` is already set up and driven by environment variables:

- `assertConnectionUrlsMatchCompose()` before anything else, and before `NestFactory.create` on purpose: creating the module connects Prisma, so a `DATABASE_URL` that stopped agreeing with `POSTGRES_*` would be reported as a refused connection rather than as the two lines of `.env` that drifted apart. `src/common/env-consistency.ts` holds the rule — see "Environment" below;
- listens on `API_PORT ?? PORT ?? 3001` at `API_HOST ?? '0.0.0.0'`;
- CORS: the list of origins from `WEB_ORIGIN` (comma-separated), `credentials: true`;
- `trust proxy` from `TRUST_PROXY`. Express counts `X-Forwarded-For` from the right, so the value is the number of proxies that **append** to it, not the number of hops a request makes — the frontend's BFF forwards the header untouched and is therefore not one of them, while the proxy in front of this service is (it appends the frontend server's address). 0 means believe nothing and use the socket address. It is what makes `req.ip` — and with it the rate limiter's bucket — the client rather than the proxy. Never set above the truth: one entry too many and `req.ip` becomes a header the client writes rather than an address.
- `bodyParser: false` plus `useBodyParsers` (`src/common/body-parsers.ts`): Nest's two parsers, with the raw body kept for the two Stripe webhooks alone — their signature is over the body exactly as it was sent, which the parsed JSON cannot give back.
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
- A new controller or service comes with a spec modelled on `src/booking/application/booking.service.spec.ts` (`Test.createTestingModule`).
- A cursor is untrusted input and gets a spec of its own — `catalogue-cursor.spec.ts`, `booking-cursor.spec.ts`, `user-cursor.spec.ts` and `lookup-cursor.spec.ts`, and both are about what the parse refuses: a key the column it names could not hold, an id that is not one, an ordering nobody offers, and a cursor the other list of this API issued. What a fake repository has to get right beside them is the shape the service reasons about (a page of `limit` rows with `hasMore`, a scope the filters narrow), not the SQL — that is the e2e specs' half.
- A service spec fakes the repositories instead of mocking Prisma — every module has them, so the only spec left holding a `PrismaService` mock is the one written for a repository itself (`src/user/user.repository.spec.ts`): `src/auth/auth.service.spec.ts`, `src/user/user.service.spec.ts`, `src/listing/listing.service.spec.ts` and `src/booking/application/booking.service.spec.ts` run their service against in-memory stores and assert what ends up stored, so the test states the rule ("a replayed token revokes the family", "an owner may read the stay and not cancel it") rather than the call the service happens to make. The fakes are typed `PublicOf<Repository>` — a mapped type keeps only the public surface, so a fake needs no inheritance and still stops compiling when the real class gains or drops a method, or changes what one returns. An argument added to an existing method it does not catch: a shorter signature stays assignable to a longer one, and method parameters are compared bivariantly even under `strictFunctionTypes`. With the repository faked, the Prisma code paths of that module are covered by e2e alone; that is the trade, and it is why `test/auth.e2e-spec.ts` and `test/listing.e2e-spec.ts` have to keep exercising them. Where a query decides something HTTP cannot provoke on demand, the e2e spec takes the repository out of the container and calls it directly instead of going through the API. There are two: `test/refresh-token.repository.e2e-spec.ts`, because which of two parallel refreshes reads the row first is a matter of timing — reading it after the winner burned it is a replay, not the race the conditional update exists for; and `test/booking.repository.e2e-spec.ts`, because two adapter-specific error shapes decide something HTTP cannot provoke: the guest foreign key (a missing listing is now refused by the `FOR UPDATE` read, so only the guest key reaches the insert) read through `violatedConstraint`, and the `EXCLUDE` constraint violation (`23P01`) read through `isExclusionViolation` when two overlapping creates race past the in-transaction check. Both are the kind of parse that has to be executed against the real driver rather than trusted.
- In e2e, check the response with a schema from `@repo/contracts` (`bookingSchema.parse(response.body)`) — that way the test catches a drift from the contract, not only a status code.
- Every route except the `@Public()` ones is behind the global guard, so an e2e spec talks to the API through the agent from `test/session.ts` (`signIn(app)`) — a `request(app.getHttpServer())` without cookies only ever gets a 401. A rule that differs by role needs an agent per role: `signInAs(app, Role.ADMIN)` registers, promotes the row and logs in again, because the token minted at registration still says `USER`. A host is not a role, so it is `signIn(app, hostCredentials)` — a second `USER` whose listing makes it the host.
- `test/event-stream.ts` reads `GET /events` off a real socket (`app.listen(0)`, once per application, and `fetch`) for the notification and conversation specs: supertest waits for a body to end, and this one never does.
- The cleanup is `resetDatabase(app)` from `test/database.ts` rather than a `deleteMany` in each spec. The order is the reason it lives in one place: bookings and conversations restrict the listings they point at, and deleting users first would cascade into listings the bookings still reference. Messages go with their conversation through `onDelete: Cascade`. Refresh tokens go with their user through `onDelete: Cascade`.

## Checks

The lint is type-aware (`recommendedTypeChecked`), so it catches what plain ESLint misses: unhandled promises, unsafe operations on `any`. Fix the rules rather than disabling them. A floating promise at the top level (like `void bootstrap()` in `main.ts`) is marked with an explicit `void`, not ignored.
