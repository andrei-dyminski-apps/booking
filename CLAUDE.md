# CLAUDE.md

Instructions for Claude Code when working in this repository.

## What this project is

`booking` is a monorepo on Turborepo + pnpm workspaces.

| Package                      | What it is                                          |
| ---------------------------- | --------------------------------------------------- |
| `apps/web`                   | Next.js 16 (App Router, Turbopack), React 19        |
| `apps/api`                   | NestJS 11 (Express), REST, Prisma 7 + PostgreSQL    |
| `packages/contracts`         | `@repo/contracts` — zod schemas of the API contract |
| `packages/ui`                | `@repo/ui` — shared React components                |
| `packages/eslint-config`     | `@repo/eslint-config` — shared ESLint configs       |
| `packages/typescript-config` | `@repo/typescript-config` — base tsconfigs          |

Node >= 22.9, the package manager is **pnpm 9** (`packageManager` in the root `package.json`).

## Commands

Everything runs **from the repository root**, through turbo:

```sh
pnpm dev            # turbo watch dev: web + api, deps rebuilt on change
pnpm build          # build every package
pnpm lint           # ESLint across all packages (Prettier formatting included)
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
```

API tests:

```sh
pnpm test           # jest, *.spec.ts next to the code; no database needed
pnpm test:e2e       # jest -c test/jest-e2e.json; needs the database, wipes tables
```

Both go through turbo and declare `dependsOn: ["^build"]`: the specs import `@repo/contracts` schemas as values, so `dist/` has to exist. Running `pnpm --filter @repo/api test` directly skips that and fails on a fresh clone.

Before considering a task done: `pnpm lint` and `pnpm check-types` have to pass.

Every package, `apps/api` included, inherits the shared presets from `packages/typescript-config` and `packages/eslint-config`; Prettier is configured by a single `.prettierrc` in the root and wired into ESLint through `eslint-plugin-prettier` — a mismatch with it fails `pnpm lint`. Details are in `rules/monorepo.md`.

## API contract

The shape of requests and responses is described by zod schemas in `packages/contracts` — that is the single source of truth. One schema yields validation in Nest (`nestjs-zod`), types for both sides and form validation in the browser. When the data format changes, change the schema rather than the two sides separately: `pnpm check-types` immediately shows what fell out of sync.

## Environment variables

The single source is the `.env` **in the repository root** (`cp .env.example .env`). There are no per-app `.env` files in `apps/*` and none should be created.

The root scripts start turbo through `node --env-file-if-exists=.env`, so the variables are visible to both tasks. A new variable has to be added in three places: `.env.example`, `globalEnv` in `turbo.json`, the table in `README.md`. Otherwise turbo will not account for it in the cache hash, and the ESLint rule `turbo/no-undeclared-env-vars` will report it.

`.env` is in `.gitignore` — do not commit it and do not read its contents without being asked.

## Rules

@.claude/rules/monorepo.md
@.claude/rules/frontend.md
@.claude/rules/backend.md
@.claude/rules/workflow.md
