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
  prisma/                # PrismaModule + PrismaService (extends PrismaClient)
  auth/                  # registration, login, the JWT pair and its rotation
    auth.config.ts       # secrets, lifetimes and cookie attributes out of the environment
    auth.controller.ts
    auth.service.ts      # passwords and the rotation rules; sees no Prisma
    user.repository.ts   # users; translates the unique violation into an error of its own
    refresh-token.repository.ts  # refresh rows, the rotation transaction and the sweep
    token.service.ts     # signs and hashes tokens; touches no database
    jwt.strategy.ts      # passport-jwt, the token is read from the cookie
    cookies.ts           # cookie names, attributes and a reader for them
    guards/              # JwtAuthGuard — registered globally in app.module.ts
    decorators/          # @Public(), @CurrentUser(), @RefreshToken()
  booking/               # the reference for new domain areas
    booking.module.ts
    booking.controller.ts
    booking.service.ts
    booking.service.spec.ts
    dto/booking.dto.ts   # createZodDto on top of the @repo/contracts schemas
```

## Prisma

- Prisma 7 does not read `.env` on its own — `prisma.config.ts` loads the root `.env` through `process.loadEnvFile`; run the CLI only through the `db:*` scripts of `apps/api` (`pnpm --filter @repo/api db:migrate` and so on).
- The client is generated into `src/generated/prisma` (`prisma generate`, which also runs in `postinstall`); the directory is gitignored and in the ESLint ignores. The generator sets `importFileExtension = ""` — otherwise ts-node does not resolve the `.js` imports in the seed.
- Database access goes through `PrismaService` only (injected; `PrismaModule` is imported by the feature module). Do not create `new PrismaClient` inside services.
- Where a module has rules worth testing on their own, the queries move one step further out, into a `*.repository.ts` next to the service: `auth/` is the reference. The repository owns the query, the transaction and the mapping of rows onto the contract types, and it translates driver-specific failures (a `P2002` becomes `EmailAlreadyRegisteredError`) so that no Prisma symbol reaches the service. The service keeps the rules and the HTTP exceptions. The direction holds both ways: a type both layers need (`IssuedRefreshToken`) lives in `auth.types.ts`, so the repository never imports from a service. A repository is a plain `@Injectable()` class injected by its own type — not an interface behind a token: a second implementation of "Postgres" is never coming, and the seam that does need one is an external service (Stripe), not the database.
- A repository is worth its files where the rules are; a plain service on `PrismaService` stays right for a module that is CRUD. `booking` gets one in phase 4, together with the locking transaction it will hide.
- The check-in/check-out columns are `@db.Date`, while dates are exposed as `YYYY-MM-DD` strings (the mapper in `BookingService`); the contract did not change when the storage did.
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

- Do not use `class-validator` and `class-transformer`: their decorators are not reused by the frontend, and the contract drifts apart.
- Format rules and relations between fields (including cross-field ones, such as "check-out after check-in") live in the contract schema. What stays in the service is what requires state: checks against other bookings, permissions, the database.
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

## main.ts

`src/main.ts` is already set up and driven by environment variables:

- listens on `API_PORT ?? PORT ?? 3001` at `API_HOST ?? '0.0.0.0'`;
- CORS: the list of origins from `WEB_ORIGIN` (comma-separated), `credentials: true`;
- `trust proxy` from `TRUST_PROXY` (the number of proxies in front of the service, 0 = none). It is what makes `req.ip` — and with it the rate limiter's bucket — the client rather than the proxy. Never set above the number of proxies that exist: each trusted hop is one more forgeable `X-Forwarded-For` entry.
- Swagger at `/docs`: the document is built from the same zod schemas, and `cleanupOpenApiDoc` is mandatory (in `nestjs-zod` 5 it replaced `patchNestJsSwagger`). It is published only when `NODE_ENV !== "production"` — the document describes the whole API surface. `addCookieAuth(ACCESS_TOKEN_COOKIE)` declares the session and `addSecurityRequirements` applies it to every operation, matching the global guard; `@Public()` is what drops it again. The credential is a cookie, so "Try it out" works from a browser that logged in through `/auth/login` and not from a pasted bearer header.

Do not hardcode the port, the host or an origin. A new frontend origin goes into `.env`, not into the code.

## Tests

- Unit: `*.spec.ts` next to the code, `rootDir: src`, run with `pnpm test` from the root. No database needed: Prisma is mocked (`{ provide: PrismaService, useValue: ... }`), and the unit tests check the service logic around the queries. The script is a bare `jest` on purpose — see the note on `--experimental-vm-modules` below.
- E2E: `test/*.e2e-spec.ts`, config `test/jest-e2e.json`, run with `pnpm test:e2e` from the root. They hit the real database from docker-compose (it needs `docker compose up -d` and applied migrations) and wipe the tables in `beforeEach`. The script loads the root `.env` and enables `--experimental-vm-modules` — do not remove it. `maxWorkers: 1` in the same config is not optional either: the spec files share one database, and in parallel workers one file's cleanup wipes rows another one is working with.
- `--experimental-vm-modules` is needed by the tests that actually execute queries, not by every test that sees Prisma. Prisma 7 has no binary engine: with a driver adapter the generated client loads a WASM query compiler through `await import(...)` on `$connect()`, and Jest forbids a dynamic import inside its vm context without the flag. Unit tests replace `PrismaService` with a mock, so its constructor never runs and `$connect()` never happens — hence no flag there. If a unit spec starts failing with `A dynamic import callback was invoked without --experimental-vm-modules`, it has reached the real database: mock Prisma, do not add the flag.
- Both test tasks are declared in `turbo.json` with `dependsOn: ["^build"]`, so run them from the root. The specs import `@repo/contracts` schemas as values and need the built `dist/`; a direct `pnpm --filter @repo/api test` skips the build and fails on a fresh clone.
- A new controller or service comes with a spec modelled on `src/booking/booking.service.spec.ts` (`Test.createTestingModule`).
- Where a module has repositories, the spec fakes them instead of mocking Prisma: `src/auth/auth.service.spec.ts` runs `AuthService` against in-memory stores and asserts what ends up stored, so the test states the rule ("a replayed token revokes the family") rather than the call the service happens to make. The fakes are typed `PublicOf<Repository>` — a mapped type keeps only the public surface, so a fake needs no inheritance and still stops compiling when the real class gains or drops a method, or changes what one returns. An argument added to an existing method it does not catch: a shorter signature stays assignable to a longer one, and method parameters are compared bivariantly even under `strictFunctionTypes`. With the repository faked, the Prisma code paths of that module are covered by e2e alone; that is the trade, and it is why `test/auth.e2e-spec.ts` has to keep exercising them. Where a query decides something HTTP cannot provoke on demand, the e2e spec takes the repository out of the container and calls it directly instead of going through the API: `test/refresh-token.repository.e2e-spec.ts` is the one so far, because which of two parallel refreshes reads the row first is a matter of timing — reading it after the winner burned it is a replay, not the race the conditional update exists for.
- In e2e, check the response with a schema from `@repo/contracts` (`bookingSchema.parse(response.body)`) — that way the test catches a drift from the contract, not only a status code.
- Every route except the `@Public()` ones is behind the global guard, so an e2e spec talks to the API through the agent from `test/session.ts` (`signIn(app)`) — a `request(app.getHttpServer())` without cookies only ever gets a 401. The cleanup deletes the users too; their refresh tokens go with them through `onDelete: Cascade`.

## Checks

```sh
pnpm --filter @repo/api lint          # eslint . --max-warnings 0
pnpm --filter @repo/api lint:fix      # eslint . --fix, Prettier formatting included
pnpm --filter @repo/api check-types   # tsc --noEmit
```

The lint is type-aware (`recommendedTypeChecked`), so it catches what plain ESLint misses: unhandled promises, unsafe operations on `any`. Fix the rules rather than disabling them. A floating promise at the top level (like `void bootstrap()` in `main.ts`) is marked with an explicit `void`, not ignored.
