# apps/api — NestJS

## Stack

NestJS 11 on Express, TypeScript, Jest + Supertest. CommonJS (unlike `apps/web`) — built by `nest build` into `dist/`. Storage is PostgreSQL (docker-compose in the root) through Prisma 7.

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
    listing.repository.ts    # the queries, the booking count, the FK violation
    listing.service.spec.ts
    dto/listing.dto.ts   # createZodDto on top of the @repo/contracts schemas
  booking/               # rules over rows; phases 4-5 give it a domain of its own
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
- **Every entity gets a repository.** The queries never sit in a service: they move one step further out, into a `*.repository.ts` next to it — `auth/`, `listing/` and `booking/` all have one, and a new domain area comes with one in the same change. The repository owns the query, the transaction and the mapping of rows onto the contract types, and it translates driver-specific failures (a `P2002` becomes `EmailAlreadyRegisteredError`) so that no Prisma symbol reaches the service. Two helpers in `src/prisma/prisma.errors.ts` are what it translates through: `isPrismaError(error, code)` narrows the error, and `violatedConstraint(error, leaf)` reads which constraint gave way. The second exists because Prisma 7 talks to Postgres through a driver adapter, which leaves `meta.target` and `meta.field_name` unset and reports what it knows under one nested path instead — that path is written down once there, and a repository only describes the leaf it expects (`{ fields }` for a unique conflict, `{ index }` for a foreign key). The service keeps the rules and the HTTP exceptions. The direction holds both ways: a type both layers need (`IssuedRefreshToken`) lives in `auth.types.ts`, so the repository never imports from a service. A repository is a plain `@Injectable()` class injected by its own type — not an interface behind a token: a second implementation of "Postgres" is never coming, and the seam that does need one is an external service (Stripe), not the database.
- The rule holds even where the module is plain CRUD, and `listing` is that case: the two files buy a service that can be unit-tested against a fake instead of a query builder, one place for `P2003` and `P2025` to become `ListingHasBookingsError` and a `null`, and no second decision to take the day the module grows a rule. `booking` shows what that day looks like — it owns rules about who may read and cancel a row, and phase 4 adds the locking transaction to the repository that is already there. What a repository does not get is an interface behind a token, see the line above: the split is between the rules and the queries, not between two implementations of Postgres.
- The check-in/check-out columns are `@db.Date`, while dates are exposed as `YYYY-MM-DD` strings (the mapper in `BookingService`); the contract did not change when the storage did.
- Money is an integer in the minor unit of the currency (`listings.price_per_night`), never a float: rounding accumulates across the nights of a stay, and Stripe takes minor units as well.
- A booking references a listing with `onDelete: Restrict` and a guest with `onDelete: Cascade`, and a listing references its owner with `onDelete: Restrict` as well. The restrict is deliberate — deleting a listing somebody has booked answers `409` instead of taking their stay down with it — and it has to hold one level up too: a cascade from `users` would have to delete listings that bookings restrict, so it would promise an account deletion the database refuses to perform. Removing an owner therefore lets go of the listings first, which is the delete order everywhere rows are wiped anyway: bookings, then listings, then users (`test/database.ts`, `prisma/seed.ts`). A guest is the case that does cascade — their bookings are theirs to take with them.
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
  `req.ip`, which is only the real client when `TRUST_PROXY` names the number of proxies in
  front of the service — `main.ts` turns it into Express's `trust proxy`.
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

- listens on `API_PORT ?? PORT ?? 3001` at `API_HOST ?? '0.0.0.0'`;
- CORS: the list of origins from `WEB_ORIGIN` (comma-separated), `credentials: true`;
- `trust proxy` from `TRUST_PROXY` (the number of proxies in front of the service, 0 = none). It is what makes `req.ip` — and with it the rate limiter's bucket — the client rather than the proxy. Never set above the number of proxies that exist: each trusted hop is one more forgeable `X-Forwarded-For` entry.
- Swagger at `/docs`: the document is built from the same zod schemas, and `cleanupOpenApiDoc` is mandatory (in `nestjs-zod` 5 it replaced `patchNestJsSwagger`). It is published only when `NODE_ENV !== "production"` — the document describes the whole API surface. `addCookieAuth(ACCESS_TOKEN_COOKIE)` declares the session and `addSecurityRequirements` applies it to every operation, matching the global guard; `@Public()` is what drops it again. The credential is a cookie, so "Try it out" works from a browser that logged in through `/auth/login` and not from a pasted bearer header.

Do not hardcode the port, the host or an origin. A new frontend origin goes into `.env`, not into the code.

## Tests

- Unit: `*.spec.ts` next to the code, `rootDir: src`, run with `pnpm test` from the root. No database needed: a service is given fakes of its repositories and a repository spec mocks `PrismaService` (`{ provide: PrismaService, useValue: ... }`), so what a unit test checks is the logic around the queries rather than the queries. The script is a bare `jest` on purpose — see the note on `--experimental-vm-modules` below.
- E2E: `test/*.e2e-spec.ts`, config `test/jest-e2e.json`, run with `pnpm test:e2e` from the root. They hit the real database from docker-compose (it needs `docker compose up -d` and applied migrations) and wipe the tables in `beforeEach`. The script loads the root `.env` and enables `--experimental-vm-modules` — do not remove it. `maxWorkers: 1` in the same config is not optional either: the spec files share one database, and in parallel workers one file's cleanup wipes rows another one is working with.
- `--experimental-vm-modules` is needed by the tests that actually execute queries, not by every test that sees Prisma. Prisma 7 has no binary engine: with a driver adapter the generated client loads a WASM query compiler through `await import(...)` on `$connect()`, and Jest forbids a dynamic import inside its vm context without the flag. No unit test ever gets the real `PrismaService` — a service sees fakes of its repositories, a repository spec a mock — so its constructor never runs and `$connect()` never happens; hence no flag there. If a unit spec starts failing with `A dynamic import callback was invoked without --experimental-vm-modules`, it has reached the real database: mock Prisma, do not add the flag.
- Both test tasks are declared in `turbo.json` with `dependsOn: ["^build"]`, so run them from the root. The specs import `@repo/contracts` schemas as values and need the built `dist/`; a direct `pnpm --filter @repo/api test` skips the build and fails on a fresh clone.
- A new controller or service comes with a spec modelled on `src/booking/booking.service.spec.ts` (`Test.createTestingModule`).
- A service spec fakes the repositories instead of mocking Prisma — every module has them, so the only spec left holding a `PrismaService` mock is the one written for a repository itself (`src/auth/user.repository.spec.ts`): `src/auth/auth.service.spec.ts`, `src/listing/listing.service.spec.ts` and `src/booking/booking.service.spec.ts` run their service against in-memory stores and assert what ends up stored, so the test states the rule ("a replayed token revokes the family", "an owner may read the stay and not cancel it") rather than the call the service happens to make. The fakes are typed `PublicOf<Repository>` — a mapped type keeps only the public surface, so a fake needs no inheritance and still stops compiling when the real class gains or drops a method, or changes what one returns. An argument added to an existing method it does not catch: a shorter signature stays assignable to a longer one, and method parameters are compared bivariantly even under `strictFunctionTypes`. With the repository faked, the Prisma code paths of that module are covered by e2e alone; that is the trade, and it is why `test/auth.e2e-spec.ts` and `test/listing.e2e-spec.ts` have to keep exercising them. Where a query decides something HTTP cannot provoke on demand, the e2e spec takes the repository out of the container and calls it directly instead of going through the API. There are two: `test/refresh-token.repository.e2e-spec.ts`, because which of two parallel refreshes reads the row first is a matter of timing — reading it after the winner burned it is a replay, not the race the conditional update exists for; and `test/booking.repository.e2e-spec.ts`, because a booking can fail on either of two foreign keys and the API only ever reaches one of them — the missing listing is the losing side of a race with `listingExists`, so a request answers 404 from the pre-flight check long before the insert. Both branches read an adapter-specific shape through `violatedConstraint`, which is exactly the kind of parse that has to be executed against the real driver rather than trusted.
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
