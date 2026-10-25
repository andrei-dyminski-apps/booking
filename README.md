# booking

A booking service monorepo: a Next.js frontend and a NestJS backend in one repository, managed by Turborepo and pnpm workspaces.

> Status: the API is a working vertical slice — any account publishes listings and books other people's and the dates are checked for overlaps. Storage is PostgreSQL via Prisma 7, and the API is behind hand-written authentication: argon2, a JWT pair in httpOnly cookies, refresh-token rotation, and role-based authorization on top. The frontend has the session half of it — sign up, sign in, a guarded profile page rendered on the server as the visitor, and a session that survives an expired access token — plus the dashboard, where a listing is published, edited and taken down, and the catalogue: a filtered, cursor-paged list of stays whose filters live in the URL, a listing page with an availability calendar and the form that takes a hold, and a bookings screen with a "Trips" and a "Hosting" side for every user and everything for an admin, filtered and paged out of the URL like the catalogue. A hold is paid for on the stay's own page through Stripe Elements, and becomes a confirmed stay when Stripe's webhook says the money arrived; cancelling a paid stay refunds it by a rule both sides read from the contract. The rest are in [docs/plan.md](docs/plan.md).

## Requirements

- Node.js >= 22.9
- pnpm 9 (`corepack enable` picks the version up from the `packageManager` field)
- Docker (for the local PostgreSQL)

## Quick start

```sh
pnpm install
cp .env.example .env
# put the three STRIPE_* keys of a Stripe test account into .env (see Payments below)
docker compose --profile stripe up -d   # PostgreSQL + Redis + `stripe listen`
pnpm --filter @repo/api db:migrate      # create the schema
pnpm --filter @repo/api db:seed         # demo data
pnpm dev
```

- the application — http://localhost:3000 (`/login`, `/register`, `/profile`)
- API — http://localhost:3001
- OpenAPI — http://localhost:3001/docs (not published when `NODE_ENV=production`)

The seed also creates three demo logins: `guest@example.com` (books stays), `owner@example.com` (hosts most of the catalogue) — both plain users, since hosting is owning a listing rather than a role — and `admin@example.com` — password `password123`. A few more accounts (`ines@example.com`, a second host who also books one of the owner's stays; `alex.morgan@example.com`, `amorgan@example.com`, `sam@example.com`, guests) share that password and exist so the filter boxes have names to suggest.

## Layout

```
apps/
  web/                    # Next.js 16, App Router, React 19
  api/                    # NestJS 11 on Express, Prisma 7 + PostgreSQL
packages/
  contracts/              # @repo/contracts — zod schemas of the API contract
  ui/                     # @repo/ui — design system: Tailwind 4 tokens + shadcn/ui
  eslint-config/          # @repo/eslint-config — shared ESLint configs (flat config)
  typescript-config/      # @repo/typescript-config — base tsconfigs
```

The applications never import each other: `web` talks to `api` over HTTP at the address from `API_ORIGIN`. The browser does not make that call itself — it goes to `/api` on the frontend's own origin, and a route handler there forwards it, which is what keeps the session a first-party cookie (see [Deployment](#deployment)). Shared frontend code goes to `@repo/ui`, which exports file by file — `import { Button } from "@repo/ui/components/button"`.

## API contract

The shape of requests and responses is described once — as zod schemas in `@repo/contracts`. The same schema yields:

- request body validation in Nest — through `nestjs-zod` and the global `ZodValidationPipe`;
- types for both sides — `z.infer`;
- form validation in the browser — through **react-hook-form**, on the field as it is left, before the request is sent;
- OpenAPI schemas at `/docs` — the documentation cannot drift away from the code.

```ts
// packages/contracts/src/booking.ts — the rule lives here
export const createBookingSchema = bookingSchema
  .omit({ id: true, createdAt: true })
  .refine((booking) => booking.from < booking.to, {
    error: "Check-out date must be later than check-in date",
    path: ["to"],
  });
```

```ts
// apps/api — a DTO on top of the schema, Nest validates on its own
export class CreateBookingDto extends createZodDto(createBookingSchema) {}

// apps/web — the same schema checks the form
const parsed = createBookingSchema.safeParse(raw);
```

Change the data format — change the schema; `pnpm check-types` shows what fell out of sync on both sides. Details on why this package is built while `@repo/ui` is not — in [packages/contracts/README.md](packages/contracts/README.md).

## Interface

The frontend is built on **Tailwind CSS 4** and **shadcn/ui** over Base UI primitives (preset `base-nova`, icons from `lucide-react`). Forms are **react-hook-form** with the contract schema as its resolver, submitting to a Server Action — everywhere except the login form, which stays a plain `action={...}` so that it works before React has hydrated. shadcn is a generator rather than a dependency: the components land in `packages/ui/src/components` as ordinary source files of this repository, so the design system is versioned and reviewed along with everything else.

```
packages/ui/
  components.json            # what the shadcn CLI writes and where
  src/
    components/              # the primitives generated so far: alert-dialog, badge,
                             #   button, card, dialog, empty, field, input, label,
                             #   select, separator, sheet, skeleton, sonner, textarea
    lib/utils.ts             # cn() — clsx + tailwind-merge
    styles/globals.css       # tokens, dark theme, @source directives for Tailwind
```

The tokens are the only place colours and radii are defined; `apps/web/src/_app/styles/globals.css` is a single `@import "@repo/ui/globals.css"`. Tailwind is run by the PostCSS pipeline of `apps/web` and scans the sources named by the `@source` directives — the package itself, and the `app/` and `src/` of `apps/web`. The frontend is named there rather than globbed as `apps/*`: that pattern would also drag `apps/api/src` into the scan.

The faces are the one thing the tokens do not own: `apps/web` loads them with `next/font` into `--app-font-sans` / `--app-font-mono`, and the token file maps those onto `--font-sans` / `--font-mono`. The names differ on purpose — a token defined as `var(--font-sans)` would reference itself, and would then hold only while the `next/font` class outranks the `@layer theme` rule Tailwind emits for it.

Primitives are generated when a screen needs one, not up front: `button`, `sonner`, the `card`, `field`, `input`, `label` and `separator` the auth forms of phase 2 asked for, the `textarea` and `alert-dialog` the owner's listing form and its confirmation needed, the `badge` that names the four states of a booking, the `dialog`, `select` and `sheet` the catalogue's filters, its ordering and the mobile navigation are drawn with, and the `empty` and `skeleton` every screen that can answer with nothing — or has yet to answer at all — shares.

A new primitive is added by the CLI from inside the package, never written by hand:

```sh
cd packages/ui && pnpm dlx shadcn@latest add dialog
pnpm lint:fix                          # from the root: the generator formats its own way
```

The import is per file — `@repo/ui/components/dialog`; inside the package the components reach each other through the `imports` map (`#components/button`, `#lib/utils`). The theme is switched by `next-themes` through a class on `<html>`.

### Screens

Routing belongs to Next.js and everything else to Feature-Sliced Design, so each file under `apps/web/app` is a one-line re-export of a slice in `apps/web/src/_pages` — the rules are in [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md).

| Route                              | What it is                                                                                                | Who sees it |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------- |
| `/`                                | the landing, one link into the catalogue                                                                  | everyone    |
| `/listings`                        | the catalogue: filters in the URL, keyset pages, cached and tagged                                        | everyone    |
| `/listings/:id`                    | one listing, its calendar and the form that takes a hold or waits                                         | everyone    |
| `/bookings`                        | Trips and Hosting (`?side=HOST`), keyset pages                                                            | signed in   |
| `/bookings/:id`                    | one stay: the payment form for its guest's hold, the status polled until the webhook lands, cancelling    | its readers |
| `/waitlist`                        | the ranges a user waits for, and those waited for on their listings (`?side=HOST`); an admin's, every one | signed in   |
| `/guests/:id/reviews`              | what hosts said about one guest, for the guest and their hosts                                            | signed in   |
| `/messages`                        | the caller's conversations, the most recent first                                                         | USER        |
| `/messages/:id`                    | one thread, paged back from its end, and the reply box                                                    | its 2 sides |
| `/notifications`                   | the caller's notifications, newest first, kept live by the stream                                         | signed in   |
| `/login`, `/register`              | the session forms, submitted to Server Actions                                                            | everyone    |
| `/profile`                         | the session as the API sees it, and "Sign out"                                                            | signed in   |
| `/dashboard`                       | the caller's own listings                                                                                 | USER        |
| `/dashboard/listings/new`, `…/:id` | publishing, editing and retiring a listing                                                                | USER        |

Every screen sits inside one shell (`apps/web/src/_app/layout`): a sidebar from `lg` up, the same list in a sheet behind the menu button below it, and a header with the theme and the two calls to action a stranger has. The shell reads `/auth/me` once for all three, and `currentUser()` is memoized for the render so the page under it does not ask again. A route that reads the API has a `loading.tsx` skeleton beside it, `notFound()` has a screen of its own, and there are two error boundaries — one under the shell and one that replaces the document when the shell itself cannot render.

On the catalogue the filters are the URL. Every one of them lives behind a "Filters" modal — a plain `GET` form, so submitting it is the browser navigating to the search it spells rather than an action keeping state in step — the ordering beside it is a box over the same four links, and what is applied is spelled out as chips, each of them a link to the same search without that filter. The price of the compact toolbar is that asking a question of your own needs JavaScript: without it the catalogue still reads, and a chip still takes a filter off a search somebody sent.

The stays screen is the same toolbar over a different list, and the two share what they can: the boxes, the chips and the ordering box live in `src/shared/ui`, while what is being filtered — the labels, the links, the parse of `searchParams` — stays in the slice of each screen. A card there carries one more link than the catalogue's does: "Stays here" is the `listingId` filter, which is how a host or an admin reaches it without typing a uuid into a box. A user sees their stays in two halves — "Trips", the ones they took, and "Hosting", the ones taken against their listings — as two links over `?side=HOST`.

The three catalogue routes are the first cached reads in the application: `GET /listings`, one listing and its availability are public and identical for every visitor, so they are stored under their URL and tagged, and a mutation of a listing or a booking invalidates the tags it actually changed. Everything personal — the session, a visitor's stays, an owner's own listings — is read `no-store` and never tagged, because the Data Cache is keyed by URL and shared with whoever asks next.

## Endpoints

Every route below except `/`, the four public `/auth/*` ones, the three reading routes
of the catalogue and a listing's reviews is behind the global `JwtAuthGuard` and answers `401` without a session.

| Method   | Path                          | What it does                                                                                           |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST`   | `/auth/register`              | register and open a session; `400` — failed the schema, `409` — email is taken                         |
| `POST`   | `/auth/login`                 | log in; `401` — wrong email or password, `403` — the account is blocked                                |
| `POST`   | `/auth/refresh`               | rotate the token pair; `401` — missing, spent or forged token, cookies cleared                         |
| `POST`   | `/auth/logout`                | end the session, `204`; answers the same without one                                                   |
| `GET`    | `/auth/me`                    | the current user; `401` — no session, the user is gone or blocked                                      |
| `GET`    | `/listings`                   | the catalogue: filters (`ownerId` among them), an ordering and a cursor; public                        |
| `GET`    | `/listings/mine`              | the caller's own listings; USER only                                                                   |
| `GET`    | `/listings/:id`               | a single listing, `404` if missing or retired; public                                                  |
| `GET`    | `/listings/:id/availability`  | the nights already taken, for a `from`/`to` window; public                                             |
| `POST`   | `/listings`                   | create, the owner taken from the session; USER only                                                    |
| `PATCH`  | `/listings/:id`               | edit; the owner or ADMIN, `403` otherwise                                                              |
| `DELETE` | `/listings/:id`               | retire, `204`; out of the catalogue, booked stays keep their record                                    |
| `GET`    | `/bookings`                   | one page of the stays the caller may see: `side`, filters, an ordering and a cursor                    |
| `GET`    | `/bookings/:id`               | a single booking; the guest, the owner of the listing or an admin                                      |
| `POST`   | `/bookings`                   | a 15-minute hold, priced by the server; USER only, `403` — own listing, `409` — dates taken            |
| `POST`   | `/bookings/:id/payment`       | opens (or answers again) the hold's PaymentIntent secret; its guest only, `409` — not awaiting payment |
| `DELETE` | `/bookings/:id`               | cancel, `204`; the guest or an admin, a paid stay's refund sent right after by a job (`refundOwed`)    |
| `POST`   | `/payments/webhook`           | Stripe's deliveries: signature checked, recorded, `200` at once, handled by a worker; public           |
| `GET`    | `/payouts/account`            | the caller's payout account as the row says it; USER only                                              |
| `POST`   | `/payouts/account/refresh`    | asks Stripe where an unfinished onboarding stands and writes it down; USER only                        |
| `POST`   | `/payouts/account/session`    | a session for Stripe's embedded components, opening the account the first time; USER only              |
| `POST`   | `/payouts/webhook`            | Stripe's thin events about hosts' accounts, into the same inbox; public                                |
| `GET`    | `/waitlist`                   | the date ranges the caller waits for, check-in still ahead, earliest first; USER only                  |
| `POST`   | `/waitlist`                   | wait for held nights; `409` — the nights are free, `403` — own listing, own stay or a full list        |
| `GET`    | `/waitlist/demand`            | ranges waited for on the caller's listings — or every one, with who waits, for an admin; keyset pages  |
| `DELETE` | `/waitlist/:id`               | leave, `204`; `404` — not the caller's, or already told the nights came free                           |
| `GET`    | `/conversations`              | every thread the caller is a side of, newest message first; `listingId`, a cursor; USER only           |
| `POST`   | `/conversations`              | a guest's message about a listing: opens the thread or continues it; USER only                         |
| `GET`    | `/conversations/:id`          | one thread as the caller's side reads it; `404` for anybody but its two sides                          |
| `GET`    | `/conversations/:id/messages` | one page of the thread, the newest message first, a cursor                                             |
| `POST`   | `/conversations/:id/messages` | a reply from either side; a retired listing does not close the thread                                  |
| `POST`   | `/conversations/:id/read`     | the caller's side has seen the thread up to `upTo`, the newest message shown; `204`                    |
| `GET`    | `/users`                      | one page of accounts: role, status, name and address filters, a cursor; ADMIN only                     |
| `GET`    | `/users/:id`                  | one account with its stay and listing counts; ADMIN only                                               |
| `PATCH`  | `/users/:id`                  | change the role and/or block; ADMIN only, `403` on the caller's own account                            |
| `GET`    | `/lookups/owners`             | accounts with a listing on offer, by `q` — a part of the address or a whole id; ADMIN                  |
| `GET`    | `/lookups/guests`             | the guests of the caller's stays, by `q`; USER (their listings') or ADMIN                              |
| `GET`    | `/lookups/listings`           | the listings of the caller's stays on `side`, retired included, by `q` — a part of the title           |
| `GET`    | `/listings/:id/reviews`       | the guests' reviews of a listing, a page and a summary; `404` if retired; public                       |
| `GET`    | `/guests/:id/reviews`         | the hosts' reviews of a guest; the guest, a host they booked with or ADMIN, else `404`                 |
| `POST`   | `/bookings/:id/reviews`       | review a confirmed stay that is over; the guest or the owner, `409` — not yet or twice                 |
| `DELETE` | `/reviews/:id`                | remove a review, `204`; ADMIN only                                                                     |
| `GET`    | `/notifications`              | one page of the caller's notifications, newest first, with a cursor                                    |
| `GET`    | `/notifications/unread-count` | how many of them are unread                                                                            |
| `POST`   | `/notifications/:id/read`     | mark one read, answers the unread count; `404` — not one of the caller's                               |
| `POST`   | `/notifications/read`         | mark all read, answers the unread count                                                                |
| `GET`    | `/events`                     | the caller's event stream (Server-Sent Events): a `sync`, then whatever happens                        |

The three lookups fill in the id filters of the admin's listings and of the stays: `q` is at
least three characters, matched anywhere in the name regardless of case — or, when it is a
whole uuid, only against the id. They are keyset-paged like the lists, in the order of the
names.

Reviews are two-sided and hang off a stay: once a `CONFIRMED` booking reaches its check-out
day, its guest may review the listing and the owner of the listing may review the guest —
one review of each kind per booking, a rating of 1 to 5 stars and a comment. Which half a
request writes follows from who sends it, so the body has no kind. The guest's half is
public, on the listing's page; the host's half is read only by the guest it is about, by
the hosts that guest has a live hold or a confirmed stay with (a cancelled or expired request does not count) and by an admin, who may also remove
either kind. Nothing on a review names its author: the kind says which side wrote it.

A conversation is one thread per guest and listing, and its host is whoever owns the listing.
Only a guest writes first; after that either side may reply. A thread carries the name of
each of its two people and the address of neither; a message says which side wrote it
(`GUEST` or `HOST`). Each side has its own read marker, so `unread` is per caller,
and an admin is not a side of any thread.

### Notifications and the event stream

The API tells an account about what concerns it: a host about a hold taken on their
listing, both sides of a stay about a cancellation (except whoever cancelled), and the
side of a finished stay a review is about. Each is a row in `notifications` first — the
record, paged at `GET /notifications` — and then an event on the account's live stream.

`GET /events` is that stream: Server-Sent Events over plain HTTP, one connection per
browser — one tab holds it and hands the events to the others — through the frontend's
proxy like every other request. Each `data` line is a value of
`serverEventSchema` in `@repo/contracts`; the first one of every connection is a `sync`
with the unread count, and every event after it carries the absolute count again, so a tab
that missed something is corrected by the next event rather than drifting. Each count comes
with a revision that only grows, so one that arrives late cannot overwrite a newer one. The API fans
events out through Redis pub/sub, so the instance that writes a notification does not
have to be the one holding the connection, and it closes each stream after five minutes so
the reconnect passes the guard again — a blocked account or a lapsed token does not keep a
stream open. The stream is one channel for everything the API pushes: the messages between
users are meant to arrive as new members of the same union, not as a second connection.

On the frontend a bell in the header shows the count and the latest notices, a new one is
announced with a toast, and `/notifications` is the whole feed.

### The waitlist

Nights somebody else holds can be waited for: the booking form offers "Notify me when free"
instead of a hold when the dates overlap what the calendar draws as taken. When a stay is
cancelled or a hold lapses unpaid, everybody waiting for nights that are now free as a whole
gets a `WAITLIST_AVAILABLE` notification at once, and their entry is taken off the list —
whoever books first takes the nights, through the same transaction as anybody else. The API
does not book on a waiter's behalf: a booking is a 15-minute hold that has to be paid, and
taken for somebody who is not looking it would lapse and block the nights for everybody.
An account waits for at most 20 ranges at a time, listed on `/waitlist`. The same page shows
a host the ranges waited for on their listings — the dates, not who waits: a waiter has
taken nothing from them yet — and an admin every range on the site with the waiter's name
(`GET /waitlist/demand`, paged, scoped by the session like `GET /bookings`).

Overlapping dates on the same listing are rejected; back-to-back bookings (check-out on the day the next guest checks in) are allowed.

### The catalogue

`GET /listings` is the one read of this API that is a search rather than a lookup, and
everything about it is in the query string, so a filtered catalogue is a link somebody can
send:

| Parameter              | What it narrows                                              |
| ---------------------- | ------------------------------------------------------------ |
| `from`, `to`           | free for those nights — both or neither, check-out exclusive |
| `minPrice`, `maxPrice` | the nightly price, to the cent like the column               |
| `guests`               | listings that hold at least that many                        |
| `sort`                 | `newest` (the default), `oldest`, `priceAsc`, `priceDesc`    |
| `cursor`, `limit`      | the page: a cursor from the previous answer, at most 50 rows |

The answer is `{ items, nextCursor }`, and `nextCursor` is `null` on the last page.

- **The pages are keyset, not offset.** A listing published while somebody is paging shifts
  every offset after it — one row shown twice, another skipped. The cursor names the row a
  page ended on (the key its ordering sorts by, the `id` beside it and the `sort` itself,
  base64 and opaque) and the next page is everything that sorts after it. It does not have
  to still exist, which is why the comparison is written out instead of handed to Prisma's
  own `cursor` option: a listing retired between two pages would otherwise end the
  catalogue early. A cursor this API did not issue is a `400` rather than a silent first
  page.
- **A cursor names a place in one ordering and in no other**, so it travels with the `sort`
  it was issued under and handing it back under another is a `400` of its own. Changing
  what the catalogue is ordered by starts the pages again, which is what dropping the
  cursor does — a client that changes `sort` drops `cursor` with it.
- **The ordering, the cursor and the index are one decision.** Four values out of two keys,
  because the tiebreaker follows the direction of the key: `price ASC, id ASC` and
  `price DESC, id DESC` are exact reverses, so one btree read forwards and backwards
  answers both — two columns disagreeing about direction would need an index apiece. Hence
  two indexes rather than four (`created_at DESC, id DESC` and `price_per_night, id`), both
  partial on `deleted_at IS NULL` — the condition every read of that table already carries,
  which keeps the retired rows out of the index that serves the catalogue. `@@index` can
  express neither the `WHERE` nor the direction, so they are raw-SQL migrations like the
  `EXCLUDE` constraint below.
- **The page starts with a seek, and that costs one redundant comparison.** `key > X OR
(key = X AND id > Y)` says exactly where the page begins, but Postgres cannot read a start
  position out of an `OR` — it would walk the index from the top and filter, so a page deep
  in the catalogue would cost what an offset costs. The `where` therefore also carries
  `key >= X`, which is implied by the `OR` and is the condition the index actually seeks
  on. A row comparison would say both at once; Prisma cannot spell one.
- **"Free for those nights" is the same predicate that refuses a booking.** The filter asks
  for listings with no stay that both holds its slot and overlaps the window, and both
  halves come from `BookingRepository`, so the catalogue and the transaction cannot
  disagree about what "taken" means. A lapsed hold holds nothing, whether or not the job
  that was to release it has run yet.
- **`GET /listings/:id/availability`** answers the same question for one listing and a
  window: the ranges already taken, whole rather than clipped to the window, so a calendar
  drawing its last day knows the nights continue. It decides nothing — `POST /bookings` is
  still refused, or not, inside the locking transaction.
- **The three reading routes are public.** A catalogue nobody may see before signing up is
  not a catalogue, and the frontend caches those answers in a store keyed by URL and shared
  between visitors, so a read that needed a session could not be cached at all. Nothing
  personal is in them.

### The stays list

`GET /bookings` is the second search of this API, and it is paged for a reason the
catalogue does not have: one of its scopes has no ceiling on it. A user's trips stay small
by themselves, their hosting is bounded by their listings, and an admin's scope is every
stay on the site.

| Parameter         | What it narrows                                                      |
| ----------------- | -------------------------------------------------------------------- |
| `side`            | a user's half: `GUEST` (the default, their trips) or `HOST`; admin — |
| `status`          | one of `PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`, `EXPIRED`        |
| `listingId`       | the stays taken against one listing                                  |
| `guestId`         | the stays one guest took                                             |
| `from`, `to`      | stays that overlap the window — both or neither, check-out exclusive |
| `sort`            | `newest` (the default), `oldest`, `checkInAsc`, `checkInDesc`        |
| `cursor`, `limit` | the page: a cursor from the previous answer, at most 50 rows         |

The answer is `{ items, nextCursor }`, the cursor is the same opaque keyset cursor the
catalogue issues, and it is refused the same way: one this API did not write, or one handed
back under another `sort`, is a `400` rather than a silent first page.

- **A filter narrows the scope; it never reaches around it.** What a caller may see is
  decided by their role inside the `where` — a user's own stays or the ones against their
  listings, as `side` picks, everything for an admin — and `guestId` is a filter on top of
  that rather than a way past it: on the guest's side it can only ever name themselves, and naming anybody else answers with
  the empty list it truthfully is. The repository `AND`s the scope with the filters instead
  of spreading them into one object, which is what makes that true of the one parameter
  that names the same column the scope does.
- **"Overlaps the window" is the predicate that refuses a booking.** `from`/`to` ask for the
  stays that touch those dates, which is the same half-open comparison the locking
  transaction makes — so the list and the rule behind it cannot disagree about what those
  dates mean.
- **Every status stays readable.** A cancelled or lapsed stay is a record its guest keeps,
  so nothing narrows these reads by status; `status` is a filter for whoever wants one, and
  the row says which of the four it is.
- **`status` reports the stored value, not the clock**, and for up to a minute those differ.
  A hold whose deadline has passed is released by a job and by the sweep behind it, so
  until one of them runs the row is still `PENDING_PAYMENT` — `?status=PENDING_PAYMENT`
  includes it and `?status=EXPIRED` does not. Its slot is already free either way: what
  the overlap check and the catalogue ask is "is this hold still holding", which reads
  `expires_at` rather than waiting for the write. The window is the sweep interval, one
  minute.
- **Four indexes, two per scope that has one** — `(created_at DESC, id DESC)` and
  `(from_date DESC, id DESC)`, each again behind `guest_id`. The tiebreaker follows the
  direction of the key, so one btree answers both directions, and none of them is partial:
  no predicate narrows this table the way `deleted_at IS NULL` narrows the listings, which
  is why they are declared on the model rather than in raw SQL. The owner's scope gets none
  of its own — it narrows by `listings.owner_id`, a column of another table — and what
  bounds it is that owner's listings rather than the site.

### Concurrent booking

`POST /bookings` creates the booking as a `PENDING_PAYMENT` hold with `expiresAt = now + 15
min` — the slot is taken while the guest pays (see Payments below). Three layers keep two guests from
taking the same nights:

1. **A locking transaction.** Creating a booking is an interactive transaction that begins
   with `SELECT ... FOR UPDATE` on the listing row, so competing requests for one listing
   serialise instead of racing; the second gets an honest `409`. `deleted_at` is read
   under that lock, and the transaction also flips this listing's lapsed holds to
   `EXPIRED` first, so a stale one neither blocks the slot nor trips the constraint below.
2. **An `EXCLUDE` constraint** (`btree_gist`, a raw-SQL migration) over
   `daterange(from, to)` for active bookings — even a bug in the service cannot write two
   overlapping active stays.
3. **A BullMQ job** (Redis) scheduled for `expiresAt` releases a still-unpaid hold, and a
   repeatable sweep once a minute releases the ones whose job never ran. Redis has no
   volume under it, so a restart drops every scheduled job — the sweep is what keeps that
   from turning into a slot nobody can book, and it is why scheduling a job is allowed to
   fail without failing the request that created the booking.

A booking that leaves the active set — cancelled or expired — frees its slot immediately
and keeps its row: a refund is recorded against it, so it goes on answering `GET /bookings/:id`
for the people who could read it before, with `status` saying what became of it. What is
refused afterwards is cancelling it a second time.

### Payments

Stripe, through a **PaymentIntent and Elements** — a payment form of the site's own rather
than a redirect to Checkout. The cycle:

1. **The server prices the stay.** The hold's `amount` is quoted inside the same locking
   transaction that takes the nights, by `nightlyPrice` from `@repo/contracts` — the rule the
   listing page quoted the guest by — and stored on the booking. Nothing about money is
   ever read from a request.
2. **The guest pays on `/bookings/:id`.** The payment form asks `POST /bookings/:id/payment`
   from the browser, which opens the hold's PaymentIntent under an idempotency key named
   after the booking — a reload is handed the same one — and Stripe Elements confirms it in
   the browser. Card details go to Stripe and never through this site.
3. **The webhook confirms the stay.** `payment_intent.succeeded` reaches
   `POST /payments/webhook`, whose signature is checked over the raw body, and only then
   does the hold become `CONFIRMED`. The browser's own "success" only starts a poll
   (TanStack Query, `refetchInterval`) that waits for the status to move.
4. **Through an inbox.** The webhook records the event in `payment_events` and answers
   `200` at once; a BullMQ worker handles it afterwards and retries it on a failure, and a
   sweep re-queues what a lost job left. Stripe delivers at least once, so an event already
   recorded is not handled again, and each step is idempotent by itself.

What else moves money:

- **Cancelling a paid stay refunds it, right after it is cancelled** — in full up to 48
  hours before check-in, and nothing after (`refundOnCancel` in `@repo/contracts`, the rule
  the page states). An admin's cancellation refunds in full. Neither may cancel a stay
  once its check-in day has come. The
  cancellation answers at once and writes what it owes on the booking (`refundOwed`); a
  job sends the refund, and the sweep of the same queue sends any refund Stripe refused
  until it goes through.
- **A hold that lapses or is cancelled withdraws its PaymentIntent.** A payment that
  completes anyway, in the moment before the withdrawal, reaches the webhook for nights that
  are no longer the guest's and is refunded in full automatically.

- **Hosts are paid by Stripe Connect, after the stay begins.** The guest pays the site;
  `PAYOUT_DELAY_HOURS` (24) after check-in the host's share — what is left after refunds,
  less `PLATFORM_FEE_RATE` (10%), both in `@repo/contracts` — is transferred to their
  connected account, funded by the guest's own charge. A host sets payouts up on
  `/dashboard/payouts` (Stripe's embedded onboarding); until then their listings take
  bookings as usual and the payouts wait, going out as soon as Stripe reports the account
  ready. A job per stay pays it when it falls due, and an hourly sweep pays whatever the
  jobs missed.
- **A refund from Stripe's dashboard and a dispute reach the stay.** A full refund of a
  confirmed stay cancels it and frees its nights; a partial one tells the guest. A refund
  after the payout takes the host's share of it back by a transfer reversal. A dispute holds
  the payout until it is decided; a lost one takes back a payout already sent.

Connect has to be switched on for the account once: Dashboard → Connect, the platform
profile, and accepting responsibility for losses — the platform carries them for its
recipients. Without it, opening a host's account answers `502`.

Locally, `stripe listen` runs as the `stripe` service of `docker-compose.yml` (behind the
`stripe` profile) and forwards the events to the API on the host. Its signing secret is
printed when it starts — `docker compose --profile stripe logs stripe`, the `whsec_…`
line — and goes into `STRIPE_PAYMENT_WEBHOOK_SECRET`.

Test cards, with any future expiry date, any CVC and any postcode:

| Card number           | What it does                       |
| --------------------- | ---------------------------------- |
| `4242 4242 4242 4242` | succeeds straight away             |
| `4000 0025 0000 3155` | asks for 3-D Secure, then succeeds |
| `4000 0000 0000 9995` | is declined (insufficient funds)   |
| `4000 0000 0000 0002` | is declined (generic decline)      |

## Authentication

Implemented by hand rather than taken from Auth.js or Clerk — the parts an interview asks about are exactly the ones a library hides.

- **Passwords** are hashed with **argon2id**. A wrong password and an unknown address produce the same `401` with the same message — and take the same time to produce it: an unknown address is verified against a throwaway hash rather than answered early, because a reply that arrives in 2 ms instead of 30 names a registered user just as plainly as a different message would.
- **A pair of JWTs.** The access token is short-lived (`JWT_ACCESS_TTL`, 15 minutes by default) and nothing can revoke it before it expires — hence its lifetime. The refresh token is long-lived and revocable: it has a row in `refresh_tokens`.
- **Cookies only, never a response body.** Both tokens leave as `httpOnly` cookies, so an XSS on the frontend can act as the user but cannot carry the session away; `localStorage` never sees them. `access_token` is scoped to `/`, `refresh_token` to `/auth` — a request to `/bookings` does not carry the credential that mints new sessions. `SameSite` is `lax`, which is the CSRF defence: a cross-site POST carries no `lax` cookie.
- **The browser holds the frontend's copy of that pair, not the API's.** The API answers the frontend's proxy, which drops those `Set-Cookie` headers and re-issues the same two tokens for its own origin, translating the scopes (`/` and `/api/auth`). So the session is first-party wherever the two services are deployed, `Max-Age` still comes from `JWT_*_TTL`, and `AUTH_COOKIE_DOMAIN` matters only to a browser poking at `/docs`.
- **Rotation with reuse detection.** Every `/auth/refresh` burns the token it was given and issues the next one in the same family. Only the SHA-256 of a token is stored: a leaked table yields nothing usable, and unlike a salted password hash a digest can be looked up by equality. A token that comes back after it was already burned means a copy of it exists somewhere else — and since the two copies are indistinguishable, the whole family is revoked and the real user logs in again.
- **The guard is global.** `JwtAuthGuard` is registered through `APP_GUARD`, so a new endpoint is closed until someone marks it `@Public()`. The open ones are `/`, `/auth/register`, `/auth/login`, `/auth/refresh` and `/auth/logout` — the last two because the access token is expected to be expired exactly there — and the three reading routes of the catalogue, which show the same thing to everybody.
- **Rate limiting.** `ThrottlerGuard` is registered before `JwtAuthGuard` — the limiter has to answer `429` before anything hashes a password, because argon2 spends 64 MB per attempt and an unauthenticated flood of `/auth/login` would otherwise be a flood of that. The API-wide ceiling is 120 requests a minute per address; `/auth/register` and `/auth/login`, the two endpoints that answer a guess, allow 10. The three public reads of the catalogue go the other way and allow 600: the frontend caches them, so what reaches the API is a cache miss arriving from that server's single address rather than from a visitor's — and a `X-Forwarded-For` that would split the bucket back apart would split the shared cache entry with it. The key is the client address, so `TRUST_PROXY` has to match the deployment — behind an unaccounted proxy every client shares one bucket.
- The `registerSchema` and `loginSchema` rules live in `@repo/contracts` like every other contract rule, so the browser and the server validate a sign-up form with the same code.

The secrets have no fallback in the code: an unset `JWT_ACCESS_SECRET` stops the process at boot instead of shipping a key that is in a public repository. `.env.example` carries development values — replace them anywhere else, `openssl rand -hex 32` generates one.

`pnpm --filter @repo/api db:seed` creates three demo logins — `guest@example.com` and `owner@example.com`, both plain users (one books, the other hosts), and `admin@example.com`, all with the password `password123` — plus a second host who also books a stay at the owner's, so one account has both a Trips and a Hosting side, and three more guests, two of whom share the name "Alex Morgan" so a lookup has two rows of one name to tell apart; eight listings, six owned by the owner and two by the second host, and eleven bookings ahead spread over the guests — enough for the catalogue's filters to have something to keep as well as something to drop — plus three stays of the demo guest that are already over, reviewed by both sides, by the guest alone and by nobody, so the demo guest and the demo owner each have a review left to write — and two conversations between the guest and the owner, one of them unread by the owner — and five waitlist entries over nights already taken, three of them the demo guest's, so `/waitlist` has something to show on each of its sides, and one a guest's wait for a stay of the demo guest's, so cancelling it sends the notice — so every rule below has something to act on from the first request. The stays are dated from the day the seed runs, so the data never ages into a puzzle. The bookings ahead are ones the API itself would accept; the three that are over are the exception it cannot write — the contract refuses a check-in in the past — which is why only the seed can give a review something to be about.

### The same session on the frontend

The two cookie scopes are what shape the browser half of it, so it is worth reading them together: the access token is scoped to `/` and the refresh token to `/auth` on the API's host. The Next.js server therefore receives a visitor's access token and never their refresh token.

- **`apps/web/proxy.ts`** (Next.js 16 renamed `middleware.ts` to that) guards `/profile`, `/bookings`, `/messages`, `/dashboard`, `/admin` and `/guests`, and answers one question — is there an access cookie. It cannot answer more: the cookie is httpOnly and only the API holds the secret that would verify it, so this only spares the server a render nobody could see. The page behind it reads `/auth/me` anyway and copes with a `401` of its own.
- **A server render reads the API as the visitor.** `credentials: "include"` is a rule for browsers and does nothing in Node, so the transport copies the access cookie out of the request Next.js is answering. It does that for uncached reads only: the answer to a cached one goes into the Data Cache under its URL and is then served to whoever asks next.
- **An expired access token is not a signed-out user.** The browser drops that cookie after fifteen minutes while the refresh token lives a week, so the login page spends one `/auth/refresh` before it shows a form and sends the visitor on where they were going. It has to happen there: the refresh cookie's path means it is attached to a request that leaves the browser for the API and to nothing that leaves the Next.js server — neither the proxy nor a render can perform that trade.
- **The forms post straight to the API**, not through a server action that would have to re-issue both cookies with attributes copied from the backend, and they validate with `loginSchema` / `registerSchema` — the same schemas that refuse the request on the other side, so a message reads the same wherever it was produced.

## Roles

Authorization is two checks, and they are deliberately not the same check.

- **The role check** is `RolesGuard`, registered globally right after `JwtAuthGuard` so that it reads the user that one put on the request. It answers "may this kind of user call this endpoint at all" from the access token alone — no query, no row — which is why it fits a guard. `@Roles(Role.USER)` is what turns it on; a route without the decorator is open to every signed-in role.
- **The ownership check** lives in the service, next to the read, because it cannot be answered before the row is there: whether _this_ listing belongs to _this_ owner is a property of the row, and a guard that decided it would have to fetch the row the handler is about to fetch anyway. A `403` from the guard means "not your kind of endpoint", a `403` from the service means "not your row".

There are two roles, `USER` and `ADMIN`. Being a host is not one of them: whoever owns a listing hosts it, and whoever booked a stay is its guest, so one account is a guest of some stays and the host of others — the way a marketplace of this kind works, where a guest becoming a host keeps their history and their reviews. An account cannot book its own listing (`403`), and any user may publish one.

The guard is membership of a set, not a hierarchy: an ADMIN does not pass an `@Roles(Role.USER)` check by being senior to a user. A route admins may use names `ADMIN` itself, so what each role can reach is readable where the route is written rather than hidden in a comparison inside the guard — and `@Roles(Role.USER)` on "create a booking" keeps meaning what it says instead of quietly admitting the role above it. The one place a hierarchy exists is the ownership check, where an admin passes without owning anything, and that is a rule about rows.

|                         | USER, as a guest      | USER, as a host        | ADMIN             |
| ----------------------- | --------------------- | ---------------------- | ----------------- |
| read the catalogue      | ✅                    | ✅                     | ✅                |
| create a listing        | ✅                    | ✅                     | —                 |
| edit / delete a listing | —                     | their own              | any               |
| create a booking        | not their own listing | —                      | —                 |
| read bookings           | their own             | against their listings | all               |
| cancel a booking        | their own             | —                      | any               |
| review a finished stay  | the place             | the guest              | —                 |
| read guest reviews      | their own             | of guests who booked   | all               |
| remove a review         | —                     | —                      | any               |
| manage users            | —                     | —                      | any but their own |

Reading and writing are separate rules over the same row: an owner sees the stays booked against their listing and cannot cancel one out from under a guest. `GET /bookings` narrows by the caller inside the `where` rather than through a query parameter that could widen it — `side` only picks which of a user's two scopes it is — so the query cannot return a row the caller may not see.

Whether a refusal is a `403` or a `404` follows from what the caller could have found anyway. A listing that belongs to another owner answers `403` — the catalogue is readable by everyone signed in, so "exists, but not yours" says nothing new. A booking answers `404`, because nothing lets a stranger list bookings and a `403` would be the one way to learn that an id exists. The `403` on cancelling is the exception that proves it: it goes to the owner of the listing, who may already read that booking, and refuses them the second right rather than the first.

Registration always writes a `USER` — the only safe default for a public endpoint, and the whole of what a guest or a host needs. `ADMIN` is given by an admin (`PATCH /users/:id`, the `/admin/users` screen; the seed sets it for the demo admin), and since `JwtStrategy` reads no database, a change of role takes effect at the next refresh: `JWT_ACCESS_TTL` is the upper bound on that lag.

An admin manages accounts instead of deleting them. **Blocking** stamps `users.blocked_at` and deletes every refresh token of the account in the same transaction, so no session can be refreshed; login answers `403` once the password is right, `/auth/me` answers `401`, and the access token left in a browser lapses within `JWT_ACCESS_TTL`. A delete was left out on purpose: bookings cascade from a user and listings restrict, so it would either erase somebody's stay history or be refused for any owner who ever listed. An admin cannot change their own role or block themselves — a site must not be able to lose its last admin by one click — so another admin does it.

The admin's screens are `/admin` (every listing on offer, each editable and retirable through the owner's own form) and `/admin/users` (the accounts, filtered in the URL like the stays). Each account has a page of its own, `/admin/users/[id]`, where its role is changed and it is blocked, with links to its stays and its listings.

## Shared configuration

Every package, `apps/api` included, inherits its configuration from `packages/*` — only what is genuinely package-specific is declared locally.

| Preset                                       | Used by                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `@repo/typescript-config/base.json`          | the base for the rest                                  |
| `@repo/typescript-config/nextjs.json`        | `apps/web`                                             |
| `@repo/typescript-config/nest.json`          | `apps/api`                                             |
| `@repo/typescript-config/react-library.json` | `packages/ui`                                          |
| `@repo/eslint-config/base`                   | the base for the rest, directly — `packages/contracts` |
| `@repo/eslint-config/next-js`                | `apps/web`                                             |
| `@repo/eslint-config/nest-js`                | `apps/api`                                             |
| `@repo/eslint-config/react-internal`         | `packages/ui`                                          |

Hence the rules shared across the repository: TypeScript in strict mode with `noUncheckedIndexedAccess`, ESLint with `--max-warnings 0`, Prettier with a single config in the root (`.prettierrc`) — which is also wired into ESLint through `eslint-plugin-prettier`, so formatting is both checked and fixed by the linter. A rule everyone needs goes into the shared preset, not into a single package.

The `nest.json` preset adds what Nest cannot work without: decorators with metadata (`experimentalDecorators`, `emitDecoratorMetadata`), a CommonJS environment and `outDir`. The `nest-js` preset enables type-aware linting (`recommendedTypeChecked`) and the node/jest globals.

## Environment variables

All settings live in a single `.env` in the repository root — there are no per-app `.env` files inside `apps/*`.

| Variable                        | What it sets                                                                 | Default                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `NODE_ENV`                      | `production` hides Swagger and marks the auth cookies `Secure`               | unset, set by the runtime                               |
| `WEB_PORT`                      | Next port (`apps/web`)                                                       | `3000`                                                  |
| `API_PORT`                      | Nest port (`apps/api`)                                                       | `3001`                                                  |
| `API_HOST`                      | the interface Nest listens on                                                | `0.0.0.0`                                               |
| `API_ORIGIN`                    | API address the Next.js server forwards to (server-side only)                | required, no fallback                                   |
| `WEB_ORIGIN`                    | origin(s) for CORS in Nest, several — comma-separated                        | `http://localhost:3000`                                 |
| `POSTGRES_USER`                 | user inside the Postgres container                                           | `booking`                                               |
| `POSTGRES_PASSWORD`             | password inside the Postgres container                                       | `booking`                                               |
| `POSTGRES_DB`                   | database name inside the Postgres container                                  | `booking`                                               |
| `POSTGRES_PORT`                 | host port the Postgres container publishes                                   | `5432`                                                  |
| `DATABASE_URL`                  | PostgreSQL connection string for the application                             | see `.env.example`                                      |
| `REDIS_PORT`                    | host port the Redis container publishes                                      | `6379`                                                  |
| `REDIS_URL`                     | Redis for the hold-expiry queue and the event stream's pub/sub               | see `.env.example`                                      |
| `JWT_ACCESS_SECRET`             | signing key of the access token                                              | required, no fallback                                   |
| `JWT_REFRESH_SECRET`            | signing key of the refresh token — a different one on purpose                | required, no fallback                                   |
| `JWT_ACCESS_TTL`                | access token lifetime, seconds (also the cookie Max-Age)                     | `900`                                                   |
| `JWT_REFRESH_TTL`               | refresh token lifetime, seconds                                              | `604800`                                                |
| `AUTH_COOKIE_DOMAIN`            | Domain of the auth cookies; empty means the host that set them               | empty                                                   |
| `TRUST_PROXY`                   | trusted `X-Forwarded-For` entries — the rate limiter's key                   | `0`                                                     |
| `STRIPE_SECRET_KEY`             | Stripe secret key (`sk_test_…`); the API opens, cancels and refunds payments | required, no fallback                                   |
| `STRIPE_PAYMENT_WEBHOOK_SECRET` | signs the webhook deliveries; `stripe listen` prints it locally              | required, no fallback                                   |
| `STRIPE_PAYOUT_WEBHOOK_SECRET`  | signs the deliveries about hosts' payout accounts (a separate destination)   | optional, falls back to `STRIPE_PAYMENT_WEBHOOK_SECRET` |
| `STRIPE_SITE`                   | this deployment's name on its payments; another site's are left alone        | `local`; required in production                         |
| `STRIPE_PUBLISHABLE_KEY`        | Stripe.js key, read by the frontend server and handed to the form            | required, no fallback                                   |

The root scripts start turbo through `node --env-file-if-exists=.env`, so the variables reach the environment of both tasks. The same `.env` is read by `docker compose` — it sits next to `docker-compose.yml`, so `POSTGRES_*` and `REDIS_PORT` are substituted into the services without extra flags; compose declares defaults for them, so the database comes up even without a `.env`.

`POSTGRES_*` and `DATABASE_URL` describe the same connection from two sides — Compose cannot assemble a URL from parts. Change the user, the password, the database name or `POSTGRES_PORT` and you have to update both places, otherwise the container comes up one way and the application arrives another; `REDIS_PORT` and `REDIS_URL` are the same pair. Only the host side of a published port is a variable — inside the container the images listen on 5432 and 6379 as they always did. The API compares the two sides at boot (`apps/api/src/common/env-consistency.ts`) and refuses to start while they disagree, naming both values — a mismatch is otherwise a refused connection with nothing pointing at its cause. The check runs only where the `POSTGRES_*` parts are set, so a deployment that supplies a ready `DATABASE_URL` and nothing else is unaffected. It does not check that the URL reaches anything: the credentials of an already created database are fixed at the first initialization of the volume, so after a change you still need `docker compose down -v`.

A new variable has to be added in three places: `.env.example`, `globalEnv` in `turbo.json` and the table above. Without the `globalEnv` entry turbo will not account for it when computing the cache hash, and ESLint will report `turbo/no-undeclared-env-vars`.

`API_ORIGIN` is read on the server and on demand (`apps/web/src/shared/config/api-url.ts`). It is deliberately not a `NEXT_PUBLIC_` variable: the browser has no use for the address, because everything it sends reaches the API through the frontend's own `/api` proxy. So it is not inlined into the bundle, changing it is a restart rather than a rebuild, and a pipeline that passes it only to the runtime container is right. There is still no fallback — an unset value fails the request with its own name in the message rather than walking to `localhost`.

A trailing slash in the value is cut by `api-url.ts`, so `http://localhost:3001` and `http://localhost:3001/` behave the same.

`TRUST_PROXY` is the number of `X-Forwarded-For` entries the API may believe, and Express counts them from the right. That makes it the number of proxies that actually **append** to the header, not the number of hops a request makes — and the frontend proxy is not one of them, because it forwards the header exactly as it received it. What appends an entry is the proxy in front of the API, which sees the frontend server as an ordinary client. Locally there is none, hence `0`; on Railway there is one, and reaching past it to the address Vercel wrote takes `2`.

Never set it higher than the truth. One entry too many and `req.ip` stops being the client address and becomes a field the client fills in — with `TRUST_PROXY=1` and nothing actually appending, `curl -H 'X-Forwarded-For: 9.9.9.9'` picks its own bucket and the limit on `/auth/login` never fires.

## Commands

From the repository root, across all packages at once:

```sh
pnpm dev            # web + api in parallel, deps rebuilt on change
pnpm build          # build every package
pnpm lint           # ESLint (formatting check included) + Steiger over the FSD structure of apps/web
pnpm lint:fix       # ESLint --fix: autofixes + reformatting by Prettier
pnpm check-types    # tsc --noEmit
pnpm test           # unit tests: jest in apps/api, vitest in apps/web and packages/contracts
pnpm format         # Prettier over **/*.{ts,tsx,md}
```

`pnpm dev` goes through `turbo watch dev`, so it is dependency-aware: edit a schema in `packages/contracts` and turbo rebuilds it and restarts `apps/api`, while `apps/web` picks the change up with its own watcher.

`pnpm format` stays the only way to format `.md` — ESLint does not parse them. It runs from the root only; packages have no local `format` scripts.

Targeted runs — through turbo filters:

```sh
pnpm turbo run dev --filter=@repo/web
pnpm turbo run build --filter=@repo/api
pnpm turbo run lint --filter=@repo/ui
```

Database (`apps/api`, Prisma 7; the CLI picks up the root `.env` itself through `prisma.config.ts`):

```sh
pnpm --filter @repo/api db:migrate    # create/apply migrations (dev)
pnpm --filter @repo/api db:seed       # load demo data
pnpm --filter @repo/api db:generate   # regenerate the client (also runs in postinstall)
pnpm --filter @repo/api db:deploy     # apply committed migrations (production; never `migrate dev`)
```

Prisma 7 removed the automatic steps that v6 performed: `db:migrate` no longer runs the seed script and no longer regenerates the client. After changing `schema.prisma` run `db:generate` yourself, and after recreating the database run `db:seed`.

The container keeps its data in the `db-data` volume, so `docker compose down` and `up -d` preserve the bookings. Data is lost only with `docker compose down -v` — which is also the only way to change `POSTGRES_*`, since those apply when the volume is first initialized.

Tests:

```sh
pnpm test           # unit, *.spec.ts next to the code; no database needed
pnpm test:e2e       # e2e, apps/api/test/*.e2e-spec.ts; needs the database from docker-compose running
```

`pnpm test` covers both applications, with a runner each: **Jest** in `apps/api`, where the specs run a service against fakes of its repositories through Nest's testing module, and **Vitest** in `apps/web` and in `packages/contracts` — the latter for `nightlyPrice` and `refundOnCancel`, the rules a night of a stay is priced by and a cancellation refunds by on both sides of the wire. What has a spec on the frontend is deliberately narrow — a parser whose input somebody else writes, which today means `?next=` after signing in ([`next-path.ts`](apps/web/src/shared/lib/next-path.ts)) and the `Set-Cookie` the proxy re-issues ([`session-cookies.ts`](apps/web/src/shared/api/session-cookies.ts)). Both are security decisions that a diff does not show, and neither is a component: a component that would break is one `check-types` and Steiger already refuse.

All of them run through turbo, which builds `@repo/contracts` first — the specs import its schemas as values, and unlike `lint` and `check-types` they need the compiled `dist/`, not the sources.

The e2e tests wipe the tables before every test — do not run them against a database whose data you care about.

Linting is strict: `--max-warnings 0` combined with `eslint-plugin-only-warn` means any remark fails the check. Formatting falls under the same umbrella through `eslint-plugin-prettier` — a file that drifted from `.prettierrc` fails `pnpm lint`. One command fixes it: `pnpm lint:fix`. Both `pnpm lint` and `pnpm check-types` must pass before a push.

In `apps/web` the same script runs [Steiger](https://github.com/feature-sliced/steiger) after ESLint: the frontend is organized by Feature-Sliced Design, and Steiger owns that half of the checks entirely — layer boundaries, cross-imports between slices, sidesteps of a public API and the shape of the tree. ESLint keeps only the ordinary rules; it resolves nothing, and duplicating architecture rules there would just give them a second place to drift. The layout is described in [apps/web/README.md](apps/web/README.md).

## Installing dependencies

Through pnpm only — `npm install` and `yarn` break `pnpm-lock.yaml`.

```sh
pnpm add <pkg> --filter @repo/web     # into a specific workspace
pnpm add -D <pkg> --filter @repo/api
pnpm add -w <pkg>                     # repository-wide tooling
```

Internal packages are wired in as `"@repo/ui": "workspace:*"`.

## Deployment

`apps/web` on Vercel, `apps/api` on Railway. The two are different sites however the domains are arranged, and a preview deployment on a throwaway `*.vercel.app` hostname is a different site again — which is why the browser never talks to the API directly. It calls `/api/...` on the frontend, `apps/web/app/api/[...path]/route.ts` forwards the request, and the session it holds is a first-party cookie of whatever hostname it happens to be visiting.

That removes three deployment problems rather than one. There is no `SameSite=None` for Safari's tracking prevention to drop. There is no CORS to keep in step with a list of origins. And a preview deployment can be pointed at any API and still log in, instead of needing a staging backend of its own.

`.railway/railway.ts` describes the API service as [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code); the `railway` devDependency is the SDK it imports. Railway's Root Directory stays the repository root — pnpm workspaces do not build from a subdirectory — so the service is narrowed by its commands instead:

- `buildCommand` filters turbo down to `@repo/api`, which builds `@repo/contracts` on the way;
- `watchPatterns` keeps a frontend-only push from redeploying the backend;
- `preDeploy` runs `db:deploy` before the new instance starts — committed migrations only, never `migrate dev`;
- `start` is a plain `node apps/api/dist/main`: the port comes from Railway's `PORT` and the host from `API_HOST`, both of which `src/main.ts` already reads.

The file exports the partial `api`, so it owns only the resources it declares: Postgres and Redis live in the same project but stay managed in the dashboard, and an apply never deletes them. A change to the file reaches Railway through the CLI rather than a push — `railway config plan`, then `railway config apply` once the plan shows only the intended changes.

Postgres is a service in the same Railway project, and `DATABASE_URL` is set as a reference to it (`${{Postgres.DATABASE_URL}}`) rather than copied — the credentials then survive a rotation. The rest of the variables from the table above are set by hand; the JWT secrets are generated (`openssl rand -hex 32`), not taken from `.env.example`.

Stripe needs one more step on each side. The webhook endpoint is registered in the Dashboard at `https://<api>/payments/webhook` for `payment_intent.succeeded`, `charge.refunded`, `refund.failed`, `charge.dispute.created` and `charge.dispute.closed`, and its signing secret becomes `STRIPE_PAYMENT_WEBHOOK_SECRET` on Railway beside `STRIPE_SECRET_KEY` and a `STRIPE_SITE` of the deployment's own (`production`); a second destination, "Your account" with the thin events `v2.core.account[configuration.recipient].capability_status_updated` and `v2.core.account[requirements].updated`, goes to `https://<api>/payouts/webhook` and its secret to `STRIPE_PAYOUT_WEBHOOK_SECRET`; `STRIPE_PUBLISHABLE_KEY` goes to Vercel, as a runtime variable like `API_ORIGIN`.

On the Vercel side `API_ORIGIN` is a runtime variable of the frontend — it is read on the server, never inlined into the bundle, so a changed API address is a redeploy without a rebuild. `TRUST_PROXY` on the Railway side has to account for the extra `X-Forwarded-For` entry the frontend server's own request produces, or the rate limiter buckets every visitor together.

While nobody uses the deployment, its Railway services can be stopped so they bill no compute, and started again later; volumes keep the data in between. `scripts/railway-power.sh` does it for the project the Railway CLI is linked to (`railway login`, `railway link`): with no arguments it asks what to do, otherwise it takes `stop`, `start` or `status` and optionally the service names (by default `Postgres Redis @repo/api`, started in that order and stopped in reverse). Stopping removes each service's latest deployment, so starting deploys it again from its source — the image for Postgres and Redis, the latest commit of the tracked branch for the API.

It needs the Railway CLI, installed once with `npm i -g @railway/cli`. The root scripts wrap it.

Interactive menu — stop, start or status:

```sh
pnpm railway
```

Status of the linked project:

```sh
pnpm railway:status
```

Stop every service (`railway down`, after a confirmation):

```sh
pnpm railway:stop
```

Start every service again (`railway redeploy`):

```sh
pnpm railway:start
```

Service names narrow any of the three to those services:

```sh
pnpm railway:start api
```

## Build cache

Turborepo caches task results locally in `.turbo`. Cacheable tasks are described in `turbo.json`; `dev` is not cached (`cache: false`, `persistent: true`) but depends on `^build` — otherwise the apps would start before `@repo/contracts` is built.

[Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching) through Vercel is optional: `pnpm turbo login`, then `pnpm turbo link`.

## Useful links

- [Turborepo: tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) and [filters](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Next.js App Router](https://nextjs.org/docs/app)
- [NestJS](https://docs.nestjs.com)
