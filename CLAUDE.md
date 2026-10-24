# CLAUDE.md

Instructions for Claude Code when working in this repository.

## What this project is

`booking` is a monorepo on Turborepo + pnpm workspaces. Two applications in `apps/*` and
the packages they share in `packages/*` — `pnpm-workspace.yaml` and each `package.json`
are the inventory.

Node >= 22.9, the package manager is **pnpm 9** (`packageManager` in the root `package.json`).

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

Tests:

```sh
pnpm test           # *.spec.ts next to the code: jest in apps/api, vitest in apps/web and packages/contracts
pnpm test:e2e       # jest -c test/jest-e2e.json; needs the database, wipes tables
```

The runners differ because the packages do: `apps/api` is CommonJS with Nest's testing module, `apps/web` is ESM and needed nothing beyond a runner. `packages/contracts` runs Vitest too, for the one rule it holds that both sides apply (`nightlyPrice`) and imports from its own sources. `pnpm test` covers all three through turbo.

All three tasks declare `dependsOn: ["^build"]`: the specs import `@repo/contracts` schemas as values, so `dist/` has to exist. Running `pnpm --filter @repo/api test` directly skips that and fails on a fresh clone.

Before considering a task done: `pnpm lint` and `pnpm check-types` have to pass.

Every package, `apps/api` included, inherits the shared presets from `packages/typescript-config` and `packages/eslint-config`; Prettier is configured by a single `.prettierrc` in the root and wired into ESLint through `eslint-plugin-prettier` — a mismatch with it fails `pnpm lint`. Details are in `rules/monorepo.md`.

## API contract

The shape of requests and responses is described by zod schemas in `packages/contracts` — that is the single source of truth. One schema yields validation in Nest (`nestjs-zod`), types for both sides and form validation in the browser. When the data format changes, change the schema rather than the two sides separately: `pnpm check-types` immediately shows what fell out of sync.

## Environment variables

The single source is the `.env` **in the repository root** (`cp .env.example .env`). There are no per-app `.env` files in `apps/*` and none should be created.

The root scripts start turbo through `node --env-file-if-exists=.env`, so the variables are visible to both tasks. A new variable has to be added in three places: `.env.example`, `globalEnv` in `turbo.json`, the table in `README.md`. Otherwise turbo will not account for it in the cache hash, and the ESLint rule `turbo/no-undeclared-env-vars` will report it.

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
