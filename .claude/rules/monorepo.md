# Monorepo rules

## Package manager

**pnpm** only. `npm install` / `yarn` break `pnpm-lock.yaml` — do not use them.

Installing a dependency into a specific workspace:

```sh
pnpm add <pkg> --filter @repo/web
pnpm add -D <pkg> --filter @repo/api
pnpm add <pkg> -w              # only for repository-wide tooling
```

Internal packages are wired in as `"@repo/ui": "workspace:*"` — not through a relative path and not through a version from npm.

## Package boundaries

- `apps/*` may depend on `packages/*`. The reverse dependency is forbidden.
- `apps/web` and `apps/api` **never import each other**. They talk over HTTP at the address from `API_ORIGIN`, and the shared contract lives in `packages/contracts`. The browser makes that call through a proxy on the frontend's own origin rather than directly — see "The BFF" in `apps/web/CLAUDE.md`.
- The shape of a request and a response → `packages/contracts` (zod schemas). A contract rule is written there once and works on both sides: request validation in Nest, form validation and response parsing in Next.
- Shared UI and frontend helpers → `packages/ui`. Do not copy components between applications.
- `@repo/ui` is the design system: Tailwind tokens plus shadcn/ui primitives generated into `src/components`. It exports file by file — `"./components/*": "./src/components/*.tsx"`, the same for `./lib/*` and `./hooks/*`, and `./globals.css` for the tokens. The import is `@repo/ui/components/button`, not `@repo/ui`; there is no barrel file and none should be added.
- Inside the package the files reach each other through the `imports` map of its `package.json` (`#components/button`, `#lib/utils`) — that is what the shadcn CLI generates. It is also why `packages/ui/tsconfig.json` declares `rootDir`: without an unambiguous project root TypeScript refuses to resolve an import map pointing at sources.
- How a primitive is added and the conventions around it — in `apps/web/CLAUDE.md`.

## Two kinds of packages

Turborepo names three strategies for internal packages; two of them are in use here.

- **Just-in-Time** — `@repo/ui` ships sources (`.tsx`) and the consumer's bundler compiles them. That works because only `apps/web` consumes it and Turbopack compiles TypeScript.
- **Compiled** — `@repo/contracts` is built by tsup into `.mjs` + `.js` + `.d.ts`, because `apps/api` consumes it and does not bundle: `nest build` is `tsc`, which emits `require("@repo/contracts")` and leaves the resolution to Node at runtime.

So the rule is about the consumer, not about the package: anything with a runtime that reaches `apps/api` has to be a compiled package. A types-only package (`type`/`interface`, erased at compile time) needs no build either way.

`@repo/contracts` points `types` at the sources and `default` at `dist` — the shape Turborepo recommends for compiled packages:

```json
"exports": {
  ".": {
    "import": { "types": "./src/index.ts", "default": "./dist/index.mjs" },
    "require": { "types": "./src/index.ts", "default": "./dist/index.js" }
  }
}
```

Type-checking therefore reads the sources and needs no build: `lint` and `check-types` pass on a fresh clone with no `dist/`, and only `build` and the runtime need it. The price is deliberate — the sources of the package land in the consumer's `tsc` program, so compiler strictness has to match. It does, because every package extends the same `base.json`.

One thing worth writing down, because the opposite is a common belief: the reason `apps/api` cannot consume sources is _not_ that `tsc` refuses to compile `.ts` from `node_modules`, nor that Node refuses to strip types there. pnpm links workspace packages and both tools resolve the realpath, which lands outside `node_modules` — Node 24 strips types there without complaint. It fails for other reasons: `allowImportingTsExtensions` has to be enabled in every consumer rather than in the package, and runtime type stripping breaks the moment a deploy materializes the files back under `node_modules`.

## Configs

Configs are inherited, not duplicated. This applies to every package, `apps/api` included:

- tsconfig: `@repo/typescript-config/{base,nextjs,nest,react-library}.json` → `extends` in the package.
- ESLint (flat config): `@repo/eslint-config/{base,next-js,nest-js,react-internal}`.
- Prettier: a single `.prettierrc` in the root. Do not create local configs in packages.

ESLint and Prettier are connected through `eslint-plugin-prettier/recommended` — it is the **last** element of every preset (`base.js`, `next.js`, `nest.js`, `react-internal.js`) and provides the `prettier/prettier` rule. Formatting is therefore checked by the linter and fixed by `pnpm lint:fix`. New rule sets go into presets before it, otherwise they override the disabling of the conflicting rules.

If a rule is needed in every package — change the shared preset, not a local config. Only what is genuinely specific is declared locally: `outDir` for `apps/api`, `outDir` and `include` for `packages/ui`.

A new application on an unfamiliar stack means a new preset in `packages/typescript-config` and `packages/eslint-config`, not a bespoke config inside `apps/*`. The stock configs generated by `create-next-app` and the Nest CLI have to be moved onto the shared presets right away, while there is little code.

The base tsconfig enables `strict` and `noUncheckedIndexedAccess`. Indexed access yields `T | undefined` — handle it explicitly rather than silencing it with `!` or `as`.

## turbo.json

- Describe a new task in `tasks`, with `dependsOn: ["^task"]` if it depends on the result of its dependencies.
- `outputs` is mandatory for cacheable tasks, otherwise the cache will be empty. Right now `build` writes into `.next/**` (web) and `dist/**` (api) — a new build directory goes into that list.
- `dev` is `cache: false`, `persistent: true`. The root script runs `turbo watch dev`, so editing `packages/*` re-runs that package's `build` and restarts whoever consumes it. Do not change those two flags.
- `lint` and `check-types` deliberately do **not** declare `dependsOn: ["^build"]` — see "Two kinds of packages". `build` and `dev` do, and that is what guarantees `dist/` exists before anything runs.
- A package-specific override goes into a `turbo.json` inside that package with `"extends": ["//"]`, not into the root file. `apps/api/turbo.json` is the only one so far: it adds `interruptible: true`, because `nest start --watch` does not notice a rebuilt dependency and has to be restarted by `turbo watch`. `next dev` notices on its own, so `apps/web` has no such file.
- A new env variable goes into `globalEnv` (see CLAUDE.md).

## What not to touch

`node_modules`, `.turbo`, `.next`, `dist`, `coverage`, `pnpm-lock.yaml` (changed only through pnpm commands), `.idea`.
