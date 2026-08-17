# booking

A booking service monorepo: a Next.js frontend and a NestJS backend in one repository, managed by Turborepo and pnpm workspaces.

> Status: a working vertical slice — bookings are created, checked for date overlaps and rendered on the frontend. Storage is PostgreSQL via Prisma 7. The next phases are in [docs/plan.md](docs/plan.md).

## Requirements

- Node.js >= 22.9
- pnpm 9 (`corepack enable` picks the version up from the `packageManager` field)
- Docker (for the local PostgreSQL)

## Quick start

```sh
pnpm install
cp .env.example .env
docker compose up -d                    # PostgreSQL
pnpm --filter @repo/api db:migrate      # migrations (+ demo data seed)
pnpm dev
```

- bookings — http://localhost:3000/bookings
- API — http://localhost:3001
- OpenAPI — http://localhost:3001/docs

## Layout

```
apps/
  web/                    # Next.js 16, App Router, React 19
  api/                    # NestJS 11 on Express, Prisma 7 + PostgreSQL
packages/
  contracts/              # @repo/contracts — zod schemas of the API contract
  ui/                     # @repo/ui — shared React components
  eslint-config/          # @repo/eslint-config — shared ESLint configs (flat config)
  typescript-config/      # @repo/typescript-config — base tsconfigs
```

The applications never import each other: `web` talks to `api` over HTTP at the address from `NEXT_PUBLIC_API_URL`. Shared frontend code goes to `@repo/ui`, which exports components file by file — `import { Button } from "@repo/ui/button"`.

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

## Endpoints

| Method   | Path            | What it does                                               |
| -------- | --------------- | ---------------------------------------------------------- |
| `GET`    | `/bookings`     | list of bookings, sorted by check-in date                  |
| `GET`    | `/bookings/:id` | a single booking, `404` if missing                         |
| `POST`   | `/bookings`     | create; `400` — failed the schema, `409` — dates are taken |
| `DELETE` | `/bookings/:id` | delete, `204`                                              |

Overlapping dates in the same room are rejected; back-to-back bookings (check-out on the day the next guest checks in) are allowed.

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

| Variable              | What it sets                                                     | Default                 |
| --------------------- | ---------------------------------------------------------------- | ----------------------- |
| `WEB_PORT`            | Next port (`apps/web`)                                           | `3000`                  |
| `API_PORT`            | Nest port (`apps/api`)                                           | `3001`                  |
| `API_HOST`            | the interface Nest listens on                                    | `0.0.0.0`               |
| `NEXT_PUBLIC_API_URL` | API address for the browser (inlined into the bundle at `build`) | `http://localhost:3001` |
| `WEB_ORIGIN`          | origin(s) for CORS in Nest, several — comma-separated            | `http://localhost:3000` |
| `POSTGRES_USER`       | user inside the Postgres container                               | `booking`               |
| `POSTGRES_PASSWORD`   | password inside the Postgres container                           | `booking`               |
| `POSTGRES_DB`         | database name inside the Postgres container                      | `booking`               |
| `DATABASE_URL`        | PostgreSQL connection string for the application                 | see `.env.example`      |

The root scripts start turbo through `node --env-file-if-exists=.env`, so the variables reach the environment of both tasks. The same `.env` is read by `docker compose` — it sits next to `docker-compose.yml`, so `POSTGRES_*` are substituted into the container without extra flags; compose declares defaults for them, so the database comes up even without a `.env`.

`POSTGRES_*` and `DATABASE_URL` describe the same credentials from two sides — Compose cannot assemble a URL from parts. Change the user, the password or the database name and you have to update both places, otherwise the container comes up with one set of credentials and the application arrives with another. The credentials of an already created database are fixed at the first initialization of the volume: after a change you need `docker compose down -v`.

A new variable has to be added in three places: `.env.example`, `globalEnv` in `turbo.json` and the table above. Without the `globalEnv` entry turbo will not account for it when computing the cache hash, and ESLint will report `turbo/no-undeclared-env-vars`.

`NEXT_PUBLIC_API_URL` ends up in the client bundle at `next build` time — changing the API address requires rebuilding the frontend.

## Commands

From the repository root, across all packages at once:

```sh
pnpm dev            # web + api in parallel
pnpm build          # build every package
pnpm lint           # ESLint (formatting check included)
pnpm lint:fix       # ESLint --fix: autofixes + reformatting by Prettier
pnpm check-types    # tsc --noEmit
pnpm format         # Prettier over **/*.{ts,tsx,md}
```

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
```

Backend tests:

```sh
pnpm --filter @repo/api test        # unit, *.spec.ts next to the code; no database needed (Prisma is mocked)
pnpm --filter @repo/api test:e2e    # e2e, test/*.e2e-spec.ts; needs the database from docker-compose running
```

The e2e tests wipe the tables before every test — do not run them against a database whose data you care about.

Linting is strict: `--max-warnings 0` combined with `eslint-plugin-only-warn` means any remark fails the check. Formatting falls under the same umbrella through `eslint-plugin-prettier` — a file that drifted from `.prettierrc` fails `pnpm lint`. One command fixes it: `pnpm lint:fix`. Both `pnpm lint` and `pnpm check-types` must pass before a push.

## Installing dependencies

Through pnpm only — `npm install` and `yarn` break `pnpm-lock.yaml`.

```sh
pnpm add <pkg> --filter @repo/web     # into a specific workspace
pnpm add -D <pkg> --filter @repo/api
pnpm add -w <pkg>                     # repository-wide tooling
```

Internal packages are wired in as `"@repo/ui": "workspace:*"`.

## Build cache

Turborepo caches task results locally in `.turbo`. Cacheable tasks are described in `turbo.json`; `dev` is not cached (`cache: false`, `persistent: true`) but depends on `^build` — otherwise the apps would start before `@repo/contracts` is built.

[Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching) through Vercel is optional: `pnpm turbo login`, then `pnpm turbo link`.

## Useful links

- [Turborepo: tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) and [filters](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Next.js App Router](https://nextjs.org/docs/app)
- [NestJS](https://docs.nestjs.com)
