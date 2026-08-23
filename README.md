# booking

A booking service monorepo: a Next.js frontend and a NestJS backend in one repository, managed by Turborepo and pnpm workspaces.

> Status: the API is a working vertical slice — owners publish listings, guests book them and the dates are checked for overlaps. Storage is PostgreSQL via Prisma 7, and the API is behind hand-written authentication: argon2, a JWT pair in httpOnly cookies, refresh-token rotation, and role-based authorization on top. The frontend has the session half of it — sign up, sign in, a guarded profile page rendered on the server as the visitor, and a session that survives an expired access token. The next phases are in [docs/plan.md](docs/plan.md).

## Requirements

- Node.js >= 22.9
- pnpm 9 (`corepack enable` picks the version up from the `packageManager` field)
- Docker (for the local PostgreSQL)

## Quick start

```sh
pnpm install
cp .env.example .env
docker compose up -d                    # PostgreSQL
pnpm --filter @repo/api db:migrate      # create the schema
pnpm --filter @repo/api db:seed         # demo data
pnpm dev
```

- the application — http://localhost:3000 (`/login`, `/register`, `/profile`)
- API — http://localhost:3001
- OpenAPI — http://localhost:3001/docs (not published when `NODE_ENV=production`)

The seed also creates three demo logins, one per role: `guest@example.com`, `owner@example.com`, `admin@example.com` — password `password123`.

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

The applications never import each other: `web` talks to `api` over HTTP at the address from `NEXT_PUBLIC_API_URL`. Shared frontend code goes to `@repo/ui`, which exports file by file — `import { Button } from "@repo/ui/components/button"`.

## API contract

The shape of requests and responses is described once — as zod schemas in `@repo/contracts`. The same schema yields:

- request body validation in Nest — through `nestjs-zod` and the global `ZodValidationPipe`;
- types for both sides — `z.infer`;
- form validation in the browser — before the request is sent;
- OpenAPI schemas at `/docs` — the documentation cannot drift away from the code.

```ts
// packages/contracts/src/booking.ts — the rule lives here
export const createBookingSchema = bookingSchema
  .omit({ id: true, createdAt: true })
  .refine((booking) => booking.from < booking.to, {
    message: "Check-out date must be later than check-in date",
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

The frontend is built on **Tailwind CSS 4** and **shadcn/ui** over Base UI primitives (preset `base-nova`, icons from `lucide-react`). shadcn is a generator rather than a dependency: the components land in `packages/ui/src/components` as ordinary source files of this repository, so the design system is versioned and reviewed along with everything else.

```
packages/ui/
  components.json            # what the shadcn CLI writes and where
  src/
    components/              # the primitives generated so far: button, card, field,
                             #   input, label, separator, sonner
    lib/utils.ts             # cn() — clsx + tailwind-merge
    styles/globals.css       # tokens, dark theme, @source directives for Tailwind
```

The tokens are the only place colours and radii are defined; `apps/web/src/_app/styles/globals.css` is a single `@import "@repo/ui/globals.css"`. Tailwind is run by the PostCSS pipeline of `apps/web` and scans the sources named by the `@source` directives — the package itself, and the `app/` and `src/` of `apps/web`. The frontend is named there rather than globbed as `apps/*`: that pattern would also drag `apps/api/src` into the scan.

The faces are the one thing the tokens do not own: `apps/web` loads them with `next/font` into `--app-font-sans` / `--app-font-mono`, and the token file maps those onto `--font-sans` / `--font-mono`. The names differ on purpose — a token defined as `var(--font-sans)` would reference itself, and would then hold only while the `next/font` class outranks the `@layer theme` rule Tailwind emits for it.

Primitives are generated when a screen needs one, not up front: `button`, `sonner`, and the `card`, `field`, `input`, `label` and `separator` the auth forms of phase 2 asked for.

A new primitive is added by the CLI from inside the package, never written by hand:

```sh
cd packages/ui && pnpm dlx shadcn@latest add dialog
pnpm lint:fix                          # from the root: the generator formats its own way
```

The import is per file — `@repo/ui/components/dialog`; inside the package the components reach each other through the `imports` map (`#components/button`, `#lib/utils`). The theme is switched by `next-themes` through a class on `<html>`.

## Endpoints

Every route below except `/` and the four public `/auth/*` ones is behind the global
`JwtAuthGuard` and answers `401` without a session.

| Method   | Path             | What it does                                                                   |
| -------- | ---------------- | ------------------------------------------------------------------------------ |
| `POST`   | `/auth/register` | register and open a session; `400` — failed the schema, `409` — email is taken |
| `POST`   | `/auth/login`    | log in; `401` — wrong email or password                                        |
| `POST`   | `/auth/refresh`  | rotate the token pair; `401` — missing, spent or forged token, cookies cleared |
| `POST`   | `/auth/logout`   | end the session, `204`; answers the same without one                           |
| `GET`    | `/auth/me`       | the current user; `401` — no session, or the user is gone                      |
| `GET`    | `/listings`      | the catalogue, newest first                                                    |
| `GET`    | `/listings/mine` | the caller's own listings; OWNER only                                          |
| `GET`    | `/listings/:id`  | a single listing, `404` if missing                                             |
| `POST`   | `/listings`      | create, the owner taken from the session; OWNER only                           |
| `PATCH`  | `/listings/:id`  | edit; OWNER (their own) or ADMIN, `403` otherwise                              |
| `DELETE` | `/listings/:id`  | delete, `204`; `409` — bookings exist against it                               |
| `GET`    | `/bookings`      | the bookings the caller may see, sorted by check-in date                       |
| `GET`    | `/bookings/:id`  | a single booking; the guest, the owner of the listing or an admin              |
| `POST`   | `/bookings`      | create; USER only, `404` — no such listing, `409` — dates are taken            |
| `DELETE` | `/bookings/:id`  | cancel, `204`; the guest or an admin                                           |

Overlapping dates on the same listing are rejected; back-to-back bookings (check-out on the day the next guest checks in) are allowed.

## Authentication

Implemented by hand rather than taken from Auth.js or Clerk — the parts an interview asks about are exactly the ones a library hides.

- **Passwords** are hashed with **argon2id**. A wrong password and an unknown address produce the same `401` with the same message — and take the same time to produce it: an unknown address is verified against a throwaway hash rather than answered early, because a reply that arrives in 2 ms instead of 30 names a registered user just as plainly as a different message would.
- **A pair of JWTs.** The access token is short-lived (`JWT_ACCESS_TTL`, 15 minutes by default) and nothing can revoke it before it expires — hence its lifetime. The refresh token is long-lived and revocable: it has a row in `refresh_tokens`.
- **Cookies only, never a response body.** Both tokens leave as `httpOnly` cookies, so an XSS on the frontend can act as the user but cannot carry the session away; `localStorage` never sees them. `access_token` is scoped to `/`, `refresh_token` to `/auth` — a request to `/bookings` does not carry the credential that mints new sessions. `SameSite` is `lax` in both environments: the frontend and the API are always the same site — one `localhost` host locally, `example.com` next to `api.example.com` in production — and cross-origin is not cross-site, so a `lax` cookie does reach a sibling subdomain. `AUTH_COOKIE_DOMAIN` is what makes the browser hand that cookie to both of them.
- **Rotation with reuse detection.** Every `/auth/refresh` burns the token it was given and issues the next one in the same family. Only the SHA-256 of a token is stored: a leaked table yields nothing usable, and unlike a salted password hash a digest can be looked up by equality. A token that comes back after it was already burned means a copy of it exists somewhere else — and since the two copies are indistinguishable, the whole family is revoked and the real user logs in again.
- **The guard is global.** `JwtAuthGuard` is registered through `APP_GUARD`, so a new endpoint is closed until someone marks it `@Public()`. The open ones are `/`, `/auth/register`, `/auth/login`, `/auth/refresh` and `/auth/logout` — the last two because the access token is expected to be expired exactly there.
- **Rate limiting.** `ThrottlerGuard` is registered before `JwtAuthGuard` — the limiter has to answer `429` before anything hashes a password, because argon2 spends 64 MB per attempt and an unauthenticated flood of `/auth/login` would otherwise be a flood of that. The API-wide ceiling is 120 requests a minute per address; `/auth/register` and `/auth/login`, the two endpoints that answer a guess, allow 10. The key is the client address, so `TRUST_PROXY` has to match the deployment — behind an unaccounted proxy every client shares one bucket.
- The `registerSchema` and `loginSchema` rules live in `@repo/contracts` like every other contract rule, so the browser and the server validate a sign-up form with the same code.

The secrets have no fallback in the code: an unset `JWT_ACCESS_SECRET` stops the process at boot instead of shipping a key that is in a public repository. `.env.example` carries development values — replace them anywhere else, `openssl rand -hex 32` generates one.

`pnpm --filter @repo/api db:seed` creates three demo logins, one per role — `guest@example.com`, `owner@example.com` and `admin@example.com`, all with the password `password123` — three listings owned by the owner and four bookings taken by the guest, so every rule below has something to act on from the first request. The stays are dated from the day the seed runs: a check-in in the past is refused by the contract, and demo data the API itself would not accept ages into a puzzle.

### The same session on the frontend

The two cookie scopes are what shape the browser half of it, so it is worth reading them together: the access token is scoped to `/` and the refresh token to `/auth` on the API's host. The Next.js server therefore receives a visitor's access token and never their refresh token.

- **`apps/web/proxy.ts`** (Next.js 16 renamed `middleware.ts` to that) guards `/profile` and answers one question — is there an access cookie. It cannot answer more: the cookie is httpOnly and only the API holds the secret that would verify it, so this only spares the server a render nobody could see. The page behind it reads `/auth/me` anyway and copes with a `401` of its own.
- **A server render reads the API as the visitor.** `credentials: "include"` is a rule for browsers and does nothing in Node, so the transport copies the access cookie out of the request Next.js is answering. It does that for uncached reads only: the answer to a cached one goes into the Data Cache under its URL and is then served to whoever asks next.
- **An expired access token is not a signed-out user.** The browser drops that cookie after fifteen minutes while the refresh token lives a week, so the login page spends one `/auth/refresh` before it shows a form and sends the visitor on where they were going. It has to happen there: the refresh cookie's path means it is attached to a request that leaves the browser for the API and to nothing that leaves the Next.js server — neither the proxy nor a render can perform that trade.
- **The forms post straight to the API**, not through a server action that would have to re-issue both cookies with attributes copied from the backend, and they validate with `loginSchema` / `registerSchema` — the same schemas that refuse the request on the other side, so a message reads the same wherever it was produced.

## Roles

Authorization is two checks, and they are deliberately not the same check.

- **The role check** is `RolesGuard`, registered globally right after `JwtAuthGuard` so that it reads the user that one put on the request. It answers "may this kind of user call this endpoint at all" from the access token alone — no query, no row — which is why it fits a guard. `@Roles(Role.OWNER)` is what turns it on; a route without the decorator is open to every signed-in role.
- **The ownership check** lives in the service, next to the read, because it cannot be answered before the row is there: whether _this_ listing belongs to _this_ owner is a property of the row, and a guard that decided it would have to fetch the row the handler is about to fetch anyway. A `403` from the guard means "not your kind of endpoint", a `403` from the service means "not your row".

The guard is membership of a set, not a hierarchy: an ADMIN does not pass an `@Roles(Role.OWNER)` check by being senior to an owner. A route admins may use names `ADMIN` itself, so what each role can reach is readable where the route is written rather than hidden in a comparison inside the guard — and `@Roles(Role.USER)` on "create a booking" keeps meaning what it says instead of quietly admitting the two roles above it. The one place a hierarchy exists is the ownership check, where an admin passes without owning anything, and that is a rule about rows.

|                         | USER      | OWNER                  | ADMIN |
| ----------------------- | --------- | ---------------------- | ----- |
| read the catalogue      | ✅        | ✅                     | ✅    |
| create a listing        | —         | ✅                     | —     |
| edit / delete a listing | —         | their own              | any   |
| create a booking        | ✅        | —                      | —     |
| read bookings           | their own | against their listings | all   |
| cancel a booking        | their own | —                      | any   |

Reading and writing are separate rules over the same row: an owner sees the stays booked against their listing and cannot cancel one out from under a guest. `GET /bookings` narrows by the role of the caller inside the `where` rather than through a query parameter, so the query cannot return a row the caller may not see.

Whether a refusal is a `403` or a `404` follows from what the caller could have found anyway. A listing that belongs to another owner answers `403` — the catalogue is readable by everyone signed in, so "exists, but not yours" says nothing new. A booking answers `404`, because nothing lets a stranger list bookings and a `403` would be the one way to learn that an id exists. The `403` on cancelling is the exception that proves it: it goes to the owner of the listing, who may already read that booking, and refuses them the second right rather than the first.

Registration always writes a `USER` — the only safe default for a public endpoint. The other two roles are set in the database (the seed does it for the demo logins), and since `JwtStrategy` reads no database, a change of role takes effect at the next refresh: `JWT_ACCESS_TTL` is the upper bound on that lag.

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

| Variable              | What it sets                                                     | Default                             |
| --------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `NODE_ENV`            | `production` hides Swagger and marks the auth cookies `Secure`   | unset, set by the runtime           |
| `WEB_PORT`            | Next port (`apps/web`)                                           | `3000`                              |
| `API_PORT`            | Nest port (`apps/api`)                                           | `3001`                              |
| `API_HOST`            | the interface Nest listens on                                    | `0.0.0.0`                           |
| `NEXT_PUBLIC_API_URL` | API address for the browser (inlined into the bundle at `build`) | required at build time, no fallback |
| `WEB_ORIGIN`          | origin(s) for CORS in Nest, several — comma-separated            | `http://localhost:3000`             |
| `POSTGRES_USER`       | user inside the Postgres container                               | `booking`                           |
| `POSTGRES_PASSWORD`   | password inside the Postgres container                           | `booking`                           |
| `POSTGRES_DB`         | database name inside the Postgres container                      | `booking`                           |
| `DATABASE_URL`        | PostgreSQL connection string for the application                 | see `.env.example`                  |
| `JWT_ACCESS_SECRET`   | signing key of the access token                                  | required, no fallback               |
| `JWT_REFRESH_SECRET`  | signing key of the refresh token — a different one on purpose    | required, no fallback               |
| `JWT_ACCESS_TTL`      | access token lifetime, seconds (also the cookie Max-Age)         | `900`                               |
| `JWT_REFRESH_TTL`     | refresh token lifetime, seconds                                  | `604800`                            |
| `AUTH_COOKIE_DOMAIN`  | Domain of the auth cookies; empty means the host that set them   | empty                               |
| `TRUST_PROXY`         | number of proxies in front of the API — the rate limiter's key   | `0`                                 |

The root scripts start turbo through `node --env-file-if-exists=.env`, so the variables reach the environment of both tasks. The same `.env` is read by `docker compose` — it sits next to `docker-compose.yml`, so `POSTGRES_*` are substituted into the container without extra flags; compose declares defaults for them, so the database comes up even without a `.env`.

`POSTGRES_*` and `DATABASE_URL` describe the same credentials from two sides — Compose cannot assemble a URL from parts. Change the user, the password or the database name and you have to update both places, otherwise the container comes up with one set of credentials and the application arrives with another. The credentials of an already created database are fixed at the first initialization of the volume: after a change you need `docker compose down -v`.

A new variable has to be added in three places: `.env.example`, `globalEnv` in `turbo.json` and the table above. Without the `globalEnv` entry turbo will not account for it when computing the cache hash, and ESLint will report `turbo/no-undeclared-env-vars`.

`NEXT_PUBLIC_API_URL` ends up in the client bundle at `next build` time — changing the API address requires rebuilding the frontend. There is no fallback in the code (`apps/web/src/shared/config/api-url.ts`): with the variable unset `next build` itself fails with an explicit error while collecting page data, instead of quietly walking to `localhost`. So it has to be present in the environment of the build, not only in that of the running application — a deploy pipeline that only passes it to the runtime container will not start.

A trailing slash in the value is cut by `api-url.ts`, so `http://localhost:3001` and `http://localhost:3001/` behave the same.

## Commands

From the repository root, across all packages at once:

```sh
pnpm dev            # web + api in parallel, deps rebuilt on change
pnpm build          # build every package
pnpm lint           # ESLint (formatting check included) + Steiger over the FSD structure of apps/web
pnpm lint:fix       # ESLint --fix: autofixes + reformatting by Prettier
pnpm check-types    # tsc --noEmit
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

Backend tests:

```sh
pnpm test           # unit, *.spec.ts next to the code; no database needed (Prisma is mocked)
pnpm test:e2e       # e2e, test/*.e2e-spec.ts; needs the database from docker-compose running
```

Both run through turbo, which builds `@repo/contracts` first — the specs import its schemas as values, and unlike `lint` and `check-types` they need the compiled `dist/`, not the sources.

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

`apps/web` on Vercel, `apps/api` on Railway, one domain across both: `example.com` for the frontend and `api.example.com` for the API. That split is what the cookie configuration above assumes — the two stay the same site, so `SameSite=Lax` is enough and `AUTH_COOKIE_DOMAIN=example.com` hands one session to the middleware of the frontend and to the API alike.

`railway.json` in the root describes the API service. Railway's Root Directory stays the repository root — pnpm workspaces do not build from a subdirectory — so the service is narrowed by its commands instead:

- `buildCommand` filters turbo down to `@repo/api`, which builds `@repo/contracts` on the way;
- `watchPatterns` keeps a frontend-only push from redeploying the backend;
- `preDeployCommand` runs `db:deploy` before the new instance starts — committed migrations only, never `migrate dev`;
- `startCommand` is a plain `node apps/api/dist/main`: the port comes from Railway's `PORT` and the host from `API_HOST`, both of which `src/main.ts` already reads.

Postgres is a service in the same Railway project, and `DATABASE_URL` is set as a reference to it (`${{Postgres.DATABASE_URL}}`) rather than copied — the credentials then survive a rotation. The rest of the variables from the table above are set by hand; the JWT secrets are generated (`openssl rand -hex 32`), not taken from `.env.example`.

On the Vercel side `NEXT_PUBLIC_API_URL` has to be present in the environment of the **build**, not only of the running application. Preview deployments live on `*.vercel.app`, which is a different site from `api.example.com`, so a session against the production API does not follow them there — a preview that needs a login points at a staging API instead.

## Build cache

Turborepo caches task results locally in `.turbo`. Cacheable tasks are described in `turbo.json`; `dev` is not cached (`cache: false`, `persistent: true`) but depends on `^build` — otherwise the apps would start before `@repo/contracts` is built.

[Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching) through Vercel is optional: `pnpm turbo login`, then `pnpm turbo link`.

## Useful links

- [Turborepo: tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) and [filters](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Next.js App Router](https://nextjs.org/docs/app)
- [NestJS](https://docs.nestjs.com)
