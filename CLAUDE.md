# CLAUDE.md

Instructions for Claude Code when working in this repository.

## What this project is

`booking` is a monorepo on Turborepo + pnpm workspaces; the product it builds is StayDesk, deployed at `https://staydesk.dev`. Two applications in `apps/*` and
the packages they share in `packages/*` — `pnpm-workspace.yaml` and each `package.json`
are the inventory.

Node 26 (`engines` and `devEngines.runtime`), the same in CI, on Railway and on Vercel (`engines` of `apps/web`), the package manager is **pnpm 12** (`packageManager` in the root `package.json`).

## Commands

Everything runs **from the repository root**, through turbo:

```sh
pnpm dev            # turbo watch dev: web + api, deps rebuilt on change
pnpm build          # build every package
pnpm lint           # ESLint across all packages (Prettier included; plus Steiger over the FSD structure of apps/web)
pnpm lint:fix       # eslint --fix across all packages: autofixes + formatting
pnpm check-types    # tsc --noEmit across all packages
pnpm format         # prettier --write over **/*.{ts,tsx,md} — needed for .md
```

Targeted runs — through a turbo filter:

```sh
pnpm turbo run dev --filter=@repo/web
pnpm turbo run build --filter=@repo/api
pnpm turbo run lint --filter=@repo/ui
```

The database is PostgreSQL from `docker-compose.yml` in the root (`docker compose up -d`):

```sh
pnpm --filter @repo/api db:migrate    # prisma migrate dev — schema only
pnpm --filter @repo/api db:seed       # demo data (Prisma 7 never seeds automatically)
pnpm --filter @repo/api db:deploy     # prisma migrate deploy — production only, applies committed migrations
```

The deployed Railway services are stopped and started again by `pnpm railway:stop` /
`pnpm railway:start` (`pnpm railway:status`, `pnpm railway` for a menu) — see "Deployment"
in `README.md`. Both act on a live deployment: run them only when the user asks.
`pnpm db:seed:railway` reseeds the deployed database — the seed deletes every demo table
first — so it is run only when the user asks, too.

The payout countries are a snapshot in the repository (`payout-countries.snapshot.ts`,
generated — never edited by hand), rewritten by `pnpm --filter @repo/api stripe:sync-countries`,
which only reads Stripe, and proposed weekly as a pull request by
`.github/workflows/payout-countries.yml`.

`pnpm --filter @repo/api stripe:probe-countries` checks the payout countries the form offers
against what Stripe opens: it opens and closes an account per country in the sandbox the
root `.env` names (a live key is refused). `stripe:probe-transfer acct_…` takes a test charge
and sends a transfer to a connected account. Both write to that Stripe account, so they are
run only when the user asks.

Tests:

```sh
pnpm test           # *.spec.ts next to the code: jest in apps/api, vitest in apps/web and packages/contracts
pnpm test:e2e       # jest -c test/jest-e2e.json; needs the database, wipes tables
pnpm test:browser   # Playwright in apps/web/e2e; starts a hermetic stack of its own in Docker
pnpm test:browser:stripe   # the same suite with Stripe's side real, against the sandbox of .env
pnpm test:browser:live     # the scenarios tagged @every-target, against the live demo
```

The runners differ because the packages do: `apps/api` is CommonJS with Nest's testing module, `apps/web` is ESM and needed nothing beyond a runner. `packages/contracts` runs Vitest too, for the rules it holds that both sides apply (`nightlyPrice`, `refundQuote`, `hostShare`) and imports from its own sources. `pnpm test` covers all three through turbo.

`pnpm test:browser` is the browser suite: the scenarios of `docs/e2e-scenarios.md` against a stack it starts itself (`apps/web/e2e/stack.ts`) — both production builds, a Postgres and a Redis of its own in the Compose project `booking-e2e`, recreated and seeded on every run, Stripe played by a stand-in of the suite's own. It never touches the development database and runs beside `pnpm dev`. What belongs in it is in "Browser suite" of `apps/web/CLAUDE.md`.

`pnpm test:browser:stripe` is that suite on its second target: the same stack with Stripe's side real — the sandbox the root `.env` names (a live key is refused), its events brought back by `stripe listen` the suite starts itself — running the scenarios tagged `@every-target` and `@real-stripe-only`. The API runs in production mode there, so that sandbox has to be in `PAYOUT_PLATFORM_COUNTRY` or the API refuses to start (`PlatformCountryCheck`). It writes to that Stripe account (payments, refunds, a connected account per run), so like the probes it is run only when the user asks, and never in CI.

`pnpm test:browser:live` is its third target: the scenarios tagged `@every-target` against the live demo, as the suite's own guest and host there (`apps/web/e2e/live.ts`, password `E2E_LIVE_PASSWORD` and optional `E2E_LIVE_GUEST_EMAIL` / `E2E_LIVE_HOST_EMAIL`), at the pace the demo's rate limiter allows, cleaning up its stays and listings before and after. `.github/workflows/live.yml` runs it on a schedule and on demand, never as a pull request check. It writes to the live demo, so locally it is run only when the user asks.

Every test task declares `dependsOn: ["^build"]`: the specs import `@repo/contracts` schemas as values, so `dist/` has to exist. Running `pnpm --filter @repo/api test` directly skips that and fails on a fresh clone.

Before considering a task done: `pnpm lint` and `pnpm check-types` have to pass.

CI (`.github/workflows/ci.yml`) runs the same commands — lint, check-types, test, build, the e2e specs against Postgres and Redis service containers, and the browser suite in a job of its own — on every pull request and push to `main`. A new variable the e2e specs need without a usable value in `.env.example` goes onto the `e2e` job's `env` there too.

Every package, `apps/api` included, inherits the shared presets from `packages/typescript-config` and `packages/eslint-config`; Prettier is configured by a single `.prettierrc` in the root and wired into ESLint through `eslint-plugin-prettier` — a mismatch with it fails `pnpm lint`. Details are in `.claude/rules/monorepo-config.md`, which loads when a config file or a shared package is touched.

## API contract

The shape of requests and responses is described by zod schemas in `packages/contracts` — that is the single source of truth. One schema yields validation in Nest (`nestjs-zod`), types for both sides and form validation in the browser. When the data format changes, change the schema rather than the two sides separately: `pnpm check-types` immediately shows what fell out of sync.

Local email goes to the Compose Mailpit inbox. The production API sends through Resend over HTTPS and records acceptance IDs and signed webhooks for background processing. Registration completes after email verification. The same outbox sends password reset and email change links. Mail environment settings, including the encryption key for pending delivery requests, DNS and recovery for suppressed addresses are in the root README.

## Environment variables

The single source is the `.env` **in the repository root** (`cp .env.example .env`). There are no per-app `.env` files in `apps/*` and none should be created.

The root scripts start turbo through `node --env-file-if-exists=.env`, so the variables are visible to both tasks. A new variable has to be added in three places: `.env.example`, `globalEnv` in `turbo.json`, the table in `README.md`. Otherwise turbo will not account for it in the cache hash, and the ESLint rule `turbo/no-undeclared-env-vars` will report it. Two kinds are not configuration and go into none of the three: a variable the CI runner sets itself (`CI`, `GITHUB_ACTIONS`), which goes into the task's `passThroughEnv`, and one a process writes for the processes it starts (the live target's `E2E_LIVE_STOPPED`, `E2E_LIVE_GUEST_JOINED` and `E2E_LIVE_READY`, handed from the browser suite's global setup to its workers and its teardown).

`.env` is in `.gitignore` — do not commit it and do not read its contents without being asked.

## Rules

The two that hold everywhere are imported here and are always in context:

@.claude/rules/monorepo.md
@.claude/rules/workflow.md

The conventions of one application live with it and are loaded when its files are —
`apps/web/CLAUDE.md` (Next.js, FSD, the shell, forms, caching) and `apps/api/CLAUDE.md`
(NestJS, Prisma, authentication, authorization, tests). Read the one for the application
being changed before changing it; they are not in context until a file under that
directory is.
